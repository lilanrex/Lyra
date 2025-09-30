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
import { startCronJobs } from './cronService.js'; 

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

    socket.emit('registered', { walletAddress, socketId: socket.id });
    console.log(`✅ Wallet ${walletAddress} successfully joined room`);

    // Check if a listener for this wallet is already active
    if (!activeListeners.has(walletAddress)) {
      const listener = new WalletListener(walletAddress, io);
      await listener.start();
      activeListeners.set(walletAddress, listener);
    }
  }); 
});

 

startCronJobs(io)

app.post('/clear-wallet/:walletAddress', async (req, res) => {
  try {
    const { walletAddress} = req.params;
    const confirmDelete = true
    // Safety check
    if (!walletAddress || confirmDelete !== true) {
      return res.status(400).json({
        error: 'Wallet address and confirmation required'
      });
    }

    // Find the user first
    const user = await prisma.user.findUnique({
      where: { walletAddress },
      include: {
        goals: true,
        budget: true,
        expenses: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Delete everything in order (respecting foreign key constraints)
    const deletedData = {
      expenses: 0,
      goals: 0,
      budget: 0,
      user: 0,
    };

    // 1. Delete all expenses
    const expensesDeleted = await prisma.expense.deleteMany({
      where: { userId: user.id }
    });
    deletedData.expenses = expensesDeleted.count;

    // 2. Delete all goals
    const goalsDeleted = await prisma.goal.deleteMany({
      where: { userId: user.id }
    });
    deletedData.goals = goalsDeleted.count;

    // 3. Delete budget (if exists)
    if (user.budget) {
      await prisma.budget.delete({
        where: { userId: user.id }
      });
      deletedData.budget = 1;
    }

    // 4. Finally, delete the user
    await prisma.user.delete({
      where: { id: user.id }
    });
    deletedData.user = 1;

    return res.json({
      success: true,
      message: `Successfully deleted all data for wallet ${walletAddress}`,
      deletedData,
    });

  } catch (error) {
    console.error('Error clearing wallet data:', error);
    return res.status(500).json({
      error: 'Failed to clear wallet data',
      details: error
    });
  }
});

app.post('/api/user/create', async (req, res) => {
  const { walletAddress, name, email } = req.body;

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
          email: email,
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
          name: name.trim(),
          email: email
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
                // Check if this is a direct budget query by looking at the original message
                const isDirectBudgetQuery = message.toLowerCase().match(/(what.*budget|show.*budget|my budget|current budget|budget.*is)/i);
                
                if (isDirectBudgetQuery && userWithData && userWithData.budget) {
                    const budget = userWithData.budget;
                    
                    // Check if the dates are valid before trying to use them.
                    if (budget.startDate && budget.endDate) {
                        const startDate = new Date(budget.startDate);
                        const endDate = new Date(budget.endDate);
                        // Override with structured budget display for direct queries
                        finalReply = `Your current ${budget.period} budget is ${budget.amount.toLocaleString()} ${budget.currency}. It is active from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}.`;
                    } else {
                        // If dates are null or missing, provide a safe fallback.
                        finalReply = `You have a budget set for ${budget.amount.toLocaleString()} ${budget.currency}, but its dates are not configured correctly. You can set a new one to fix this.`;
                    }
                } else if (isDirectBudgetQuery && (!userWithData || !userWithData.budget)) {
                    // If no budget exists for direct query, provide a helpful message.
                    finalReply = "You don't have a budget set up yet. You can create one by saying, for example, 'Set a weekly budget of 50,000 NGN'.";
                }
                // For non-direct queries, keep the AI's original contextual reply
                // This allows the AI to use budget info in complex responses without override
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

         if (intent.action === "advise_on_surplus") {
            // The AI has provided advice. Save its suggestion to the database.
            if (intent.suggestedSplit) {
                await prisma.user.update({
                    where: { walletAddress },
                    data: { lastSuggestedSplit: intent.suggestedSplit }
                });
            }
        }
        else if (intent.action === "execute_split") {
            // The user wants to act. Retrieve the last saved split.
            const user = await prisma.user.findUnique({ where: { walletAddress } });
            
            // If the AI provided a new split (direct command), use it.
            // Otherwise, use the one we saved in the database from the last advice.
            const splitToExecute = intent.suggestedSplit || user?.lastSuggestedSplit;

            if (!splitToExecute) {
                finalReply = "I'm not sure what split to execute. Could you first ask for my advice on how to manage your surplus?";
            } else {
                // Pass the split to execute back to the frontend in the intent object.
                intent.suggestedSplit = splitToExecute;
            }
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