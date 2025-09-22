import express from "express"
import cors from "cors"
import {createServer} from 'http'
import { Server } from "socket.io";
import bodyParser from "body-parser";
import jwt from "jsonwebtoken"
import { PublicKey } from "@solana/web3.js";
import txRoutes from "./txRoutes.js"
import authRoutes from './authRoutes.js'
import crypto from 'crypto';
import { parseIntent } from '@sol-ai/agent';
import cron from "node-cron"
import actionRoutes from "./actionRoutes.js"
import reportRoute from './reportRoute.js'

import pkg from '@prisma/client';
import { Wallet } from "@coral-xyz/anchor";
const { PrismaClient } = pkg;

import { WalletListener, activeListeners,updateUserWalletBalance } from "./walletListener.js";

const prisma = new PrismaClient()
const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use(bodyParser.json())

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey"


app.use('/api/tx', txRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/action', actionRoutes)
app.use('/api/reports', reportRoute)


const httpServer = createServer(app);

// --- Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*", // you can restrict to your frontend URL
    methods: ["GET", "POST"]
  }
});

// ✅ make io available globally (so walletListener.js can use it)
app.set("io", io);

// --- Socket.IO connection log
io.on("connection", (socket) => {
  console.log("Frontend connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Frontend disconnected:", socket.id);
  
  });

  socket.on("register_wallet", async (walletAddress) => {
    console.log(`User ${socket.id} wants to listen to wallet: ${walletAddress}`);

    // Join a room specific to this wallet
    socket.join(walletAddress);

    // Check if a listener for this wallet is already active
    if (!activeListeners.has(walletAddress)) {
      const listener = new WalletListener(walletAddress, io);
      await listener.start();
      activeListeners.set(walletAddress, listener);
    }
  }); 
});

 

cron.schedule('0 0 * * *', async () => {
  console.log('⏰ Running daily check for ended budgets...');
  try {
    const now = new Date();

    // 1. Find all active budgets whose end date has passed.
    const endedBudgets = await prisma.budget.findMany({
      where: {
        status: 'ACTIVE',
        endDate: {
          lte: now, // Find budgets whose end date is now or in the past
        },
      },
      include: {
        user: {
          include: {
            expenses: true, // Include expenses to calculate surplus
          },
        },
      },
    });

    if (endedBudgets.length === 0) {
      console.log('No budgets ended today.');
      return;
    }

    console.log(`Found ${endedBudgets.length} budget(s) to process.`);

    for (const budget of endedBudgets) {
      // 2. Calculate the surplus for the completed period.
      const expensesInPeriod = budget.user.expenses.filter(
        (exp) =>
          exp.type === 'expense' &&
          new Date(exp.createdAt) >= budget.startDate &&
          new Date(exp.createdAt) < budget.endDate
      );

      const totalSpent = expensesInPeriod.reduce(
        (sum, exp) => sum + (exp.amountNGN || 0),
        0
      );
      
      const surplus = budget.amount - totalSpent;

      if (surplus > 0) {
        console.log(
          `✅ User ${budget.user.walletAddress} has a surplus of ${surplus.toFixed(2)} ${budget.currency}!`
        );
        // TODO: Implement your "Save" or "Stake" logic here.
        // This could involve a Solana blockchain transaction.
        // For now, you could save it to a 'Savings' model in your DB.
      } else {
        console.log(`User ${budget.user.walletAddress} has no surplus for this period.`);
      }

      // 3. Mark the processed budget as 'ENDED'.
      await prisma.budget.update({
        where: { id: budget.id },
        data: { status: 'ENDED' },
      });

       // ✨ --- NEW CONDITIONAL LOGIC --- ✨
      if (budget.isRecurring) {
        // If the budget is set to recur, create the next one automatically.
        // ... (this is the same logic you had before for creating a new budget)
        const newStartDate = new Date(budget.endDate);
        const newEndDate = new Date(newStartDate);

        if (budget.period === 'daily') {
          newEndDate.setDate(newStartDate.getDate() + 1);
        } else if (budget.period === 'weekly') {
          newEndDate.setDate(newStartDate.getDate() + 7);
        } else { // monthly
          newEndDate.setMonth(newStartDate.getMonth() + 1);
        }
        
        await prisma.budget.create({
          data: { /* ... all budget fields ... */ },
        });

        console.log(`New recurring budget created for user ${budget.user.walletAddress}.`);

      } else {
        // If not recurring, send a prompt to the user via Socket.IO.
        const walletAddress = budget.user.walletAddress;
        
        const promptMessage = {
            reply: `Your ${budget.period} budget of ${budget.amount} ${budget.currency} has ended. Would you like to set a new one?`,
            // You can add suggested actions for your frontend UI
            suggestions: [`Yes, set another ${budget.period} budget`, "No thanks"], 
        };

        io.to(walletAddress).emit('budget_ended_prompt', promptMessage);
        console.log(`Sent budget-ended prompt to user ${walletAddress}.`);
      }
    }
  } catch (err) {
    console.error('❌ Error in scheduled budget task:', err);
  }
});



app.post('/api/user/create', async (req, res) => {
  const { walletAddress, name } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' });
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Valid name is required' });
  }

  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress }
    });

    if (existingUser) {
      // Update the existing user with the name if it wasn't set before
      const updatedUser = await prisma.user.update({
        where: { walletAddress },
        data: { 
          name: name.trim(),
          updatedAt: new Date()
        }
      });
      
      return res.status(200).json({ 
        success: true, 
        user: updatedUser,
        message: 'User updated successfully'
      });
    } else {
      // Create new user
      const newUser = await prisma.user.create({
        data: {
          walletAddress,
          name: name.trim()
        }
      });

      return res.status(201).json({ 
        success: true, 
        user: newUser,
        message: 'User created successfully'
      });
    }
  } catch (error) {
    console.error('DB Error creating user:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/user/:wallet', async (req, res) => {
  // The fix is here: The route parameter is now ':wallet', so req.params.wallet will be defined.
  const { wallet } = req.params;

  if (!wallet) {
    return res.status(400).json({ error: 'Wallet address is required in the URL.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { walletAddress: wallet }
    });

    if (user) {
      return res.status(200).json({
        exists: true,
        user: {
          id: user.id,
          walletAddress: user.walletAddress,
          name: user.name,
          createdAt: user.createdAt
        }
      });
    } else {
      return res.status(200).json({
        exists: false,
        user: null
      });
    }
  } catch (error) {
    console.error('DB Error checking user:', error);
    return res.status(500).json({ error: 'Failed to check user' });
  }
});


app.get('/api/goals/:wallet', async (req, res) => {
    const { wallet } = req.params;

    if (!wallet) {
        return res.status(400).json({ error: 'Wallet address is required in the URL.' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { walletAddress: wallet },
        });

        if (!user) {
            return res.status(404).json({ error: 'User with that wallet address not found.' });
        }

        const goals = await prisma.goal.findMany({
            where: { userId: user.id },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return res.status(200).json({ success: true, goals });
    } catch (error) {
        console.error('Error fetching goals:', error);
        return res.status(500).json({ error: 'Failed to fetch goals.' });
    }
});



app.post('/api/budget', async(req,res) => {
   const {walletAddress, amount, currency, name} = req.body;

    if (!walletAddress || !amount || !currency) {
        return res.status(400).json({success: false, error: 'Missing required fields'});
    }

    try {
        const user = await prisma.user.upsert({
            where: { walletAddress },
            update: { name },
            create: { walletAddress, name: name || null },
        });

        const budget = await prisma.budget.upsert({
            where: { userId: user.id },
            update: { amount, currency },
            create: { amount, currency, userId: user.id },
        });

        return res.status(201).json({success: true, budget});
    } catch(err) {
        console.error('DB Error: ', err);
        return res.status(500).json({success: false, error: 'Failed to save budget'});
    }
})

app.get('/api/budget/:walletAddress', async(req,res) => {

  const {walletAddress} = req.params;

    try {
        const user = await prisma.user.findUnique({
            where: { walletAddress },
            include: { budget: true }
        });

        if (!user || !user.budget) {
            return res.json({success: true, budget: null});
        }
        
        return res.json({success: true, budget: user.budget});
    } catch (err) {
        console.error('DB Error: ', err);
        return res.status(500).json({success: false, error: 'Failed to fetch budget'});
    }

})

app.post('/api/expenses', async(req,res)=> {
    const {walletAddress, expenses} = req.body;
    const isBulkExpenses = Array.isArray(expenses);

    if (!walletAddress) {
        return res.status(400).json({success: false, error: 'Wallet address is required'});
    }

    if (isBulkExpenses) {
        if (!expenses || expenses.length === 0) {
            return res.status(400).json({success: false, error: 'Expenses array cannot be empty'});
        }
    } else {
        const {amount, description, category} = req.body;
        if (!amount || !description || !category) {
            return res.status(400).json({success: false, error: 'Missing required fields'});
        }
    }

    try {
        const user = await prisma.user.upsert({
            where: { walletAddress },
            update: {},
            create: { walletAddress },
        });

        if (isBulkExpenses) {
            const expenseData = expenses.map(expense => ({
                amount: parseFloat(expense.amount),
                amountUSD: parseFloat(expense.amountUSD),
                amountNGN: parseFloat(expense.amountNGN),
                description: expense.description,
                category: expense.category,
                currency: expense.currency || 'NGN',
                type: expense.type || 'expense', // Assuming default type
                date: expense.date ? new Date(expense.date) : new Date(),
                userId: user.id
            }));
            
            const createdExpenses = await prisma.expense.createMany({ data: expenseData });

            const fetchedExpenses = await prisma.expense.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' },
                take: createdExpenses.count,
                include: { user: { select: { walletAddress: true, name: true } } }
            });

            return res.status(201).json({
                success: true,
                message: `${createdExpenses.count} expenses created successfully`,
                expenses: fetchedExpenses
            });
        } else {
            const {amount, description, category, currency, date, amountUSD, amountNGN} = req.body;
            
            const expense = await prisma.expense.create({
                data: {
                    amount: parseFloat(amount),
                    amountUSD: parseFloat(amountUSD),
                    amountNGN: parseFloat(amountNGN),
                    description,
                    category,
                    currency: currency || 'NGN',
                    type: req.body.type || 'expense',
                    date: date ? new Date(date) : new Date(),
                    userId: user.id
                },
                include: { user: { select: { walletAddress: true, name: true } } }
            });

            return res.status(201).json({success: true, expense});
        }
    } catch (err) {
        console.error('DB error: ', err);
        return res.status(500).json({success: false, error: 'Failed to create expense(s)'});
    }
})


app.get('/api/expenses/:walletAddress', async(req, res) => {
    const {walletAddress} = req.params;
    const {category, limit = 50, offset = 0, startDate, endDate} = req.query;

    try {
        const user = await prisma.user.findUnique({
            where: { walletAddress }
        });

        if (!user) {
            return res.json({success: true, expenses: []});
        }

        const where = { userId: user.id };

        if (category) {
            where.category = category;
        }

        if (startDate || endDate) {
            where.date = {};
            if (startDate) where.date.gte = new Date(startDate );
            if (endDate) where.date.lte = new Date(endDate);
        }

        const expenses = await prisma.expense.findMany({
            where,
            orderBy: { date: 'desc' },
            take: parseInt(limit ),
            skip: parseInt(offset ),
            include: { user: { select: { walletAddress: true, name: true } } }
        });

        return res.json({success: true, expenses});
    } catch(err) {
        console.error('DB Error: ', err);
        return res.status(500).json({success: false, error: 'Failed to fetch expenses'});
    }
})


app.delete('/api/expenses/:id',  async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ success: false, error: 'Expense ID is required' });
    }

    try {
        
        // Delete the expense from the database
        await prisma.expense.delete({
            where: { id: parseInt(id) },
        });

        return res.status(200).json({ success: true, message: `Expense with ID ${id} deleted successfully.` });
    } catch (err) {
        console.error('DB Error: ', err);
        return res.status(500).json({ success: false, error: 'Failed to delete expense.' });
    }
});


app.post('/api/ai/parse', async (req, res) => {
    const { message, walletAddress } = req.body;
    if (!message) {
        return res.status(400).json({ message: 'message is required' });
    }

    try {
        if (walletAddress) {
            await updateUserWalletBalance(walletAddress);
        }
        
        let userWithData = null;
        if (walletAddress) {
            userWithData = await prisma.user.findUnique({
                where: { walletAddress },
                include: {
                    budget: true,
                    expenses: {
                        orderBy: { createdAt: 'desc' },
                        take: 20,
                    },
                    goals: true,
                },
            });
        }

        const intent = await parseIntent(message, userWithData);
        let finalReply = intent.reply;

        if (intent.type === "finance" && walletAddress) {
            
            if (intent.action === "set_budget") {
                const user = await prisma.user.upsert({
                    where: { walletAddress },
                    update: {},
                    create: { walletAddress },
                });

                const now = new Date();
                let period = 'weekly';
                const description = intent.description?.toLowerCase() || '';

                if (description.includes('monthly')) period = 'monthly';
                else if (description.includes('daily')) period = 'daily';
                
                const endDate = new Date(now);
                if (period === 'weekly') endDate.setDate(now.getDate() + 7);
                else if (period === 'monthly') endDate.setMonth(now.getMonth() + 1);
                else endDate.setDate(now.getDate() + 1);

                const isRecurringBoolean = String(intent.isRecurring).toLowerCase() === 'true';

                await prisma.budget.upsert({
                    where: { userId: user.id },
                    update: {
                        amount: Number(intent.amount),
                        currency: intent.currency,
                        period: period,
                        status: 'ACTIVE',
                        startDate: now,
                        endDate: endDate,
                        isRecurring: isRecurringBoolean,
                    },
                    create: {
                        userId: user.id,
                        amount: Number(intent.amount),
                        currency: intent.currency,
                        period: period,
                        status: 'ACTIVE',
                        startDate: now,
                        endDate: endDate,
                        isRecurring: isRecurringBoolean,
                    },
                });
                finalReply = `Your budget has been successfully updated to ${Number(intent.amount).toLocaleString()} ${intent.currency} per ${period}.`;
            } 
            // ✨ FIX: Re-added the get_budget logic with robust date checking.
            else if (intent.action === "get_budget") {
                if (userWithData && userWithData.budget) {
                    const budget = userWithData.budget;
                    
                    // Check if the dates are valid before trying to use them.
                    if (budget.startDate && budget.endDate) {
                        const startDate = new Date(budget.startDate);
                        const endDate = new Date(budget.endDate);
                        // If data is good, create a precise, data-driven reply.
                        finalReply = `Your current ${budget.period} budget is ${budget.amount.toLocaleString()} ${budget.currency}. It is active from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}.`;
                    } else {
                        // If dates are null or missing, provide a safe fallback.
                        finalReply = `You have a budget set for ${budget.amount.toLocaleString()} ${budget.currency}, but its dates are not configured correctly. You can set a new one to fix this.`;
                    }
                } else {
                    // If no budget exists at all, provide a helpful message.
                    finalReply = "You don't have a budget set up yet. You can create one by saying, for example, 'Set a weekly budget of 50,000 NGN'.";
                }
            }
            else if (intent.action === "set_goal") {
                const user = await prisma.user.upsert({
                    where: { walletAddress },
                    update: {},
                    create: { walletAddress },
                });

                const goalName = intent.goalName || intent.description;
                const targetAmount = intent.targetAmount || intent.amount;
                const goalType = intent.goalType || 'SAVINGS';

                if (!goalName || !targetAmount) {
                    return res.status(400).json({ 
                        error: 'Could not set goal. I need a name and a target amount.' 
                    });
                }
                
                await prisma.goal.create({
                    data: {
                        name: goalName,
                        targetAmount: Number(targetAmount),
                        type: goalType.toUpperCase() === 'INVESTMENT' ? 'INVESTMENT' : 'SAVINGS',
                        userId: user.id,
                    },
                });
                
                // We let the AI's original reply pass through.
            }
        }

         else if (intent.action === "generate_report") {
            // The AI has already crafted a reply like "Sure, preparing your report now..."
            // We don't need to override it. The frontend will handle the download.
            // This block is here to formally recognize the action.
        }

        return res.json({
            success: true,
            intent,
            reply: finalReply,
        });
    } catch (err) {
        console.error('AI Route Error:', err);
        return res.status(500).json({
            error: 'Failed to process AI request',
            detail: err.message,
        });
    }
});






// health check
app.get('/', (req,res)=> {

    res.json({status: 'Backend running!'})
})

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});