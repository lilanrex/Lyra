import { parseIntent } from '@sol-ai/agent';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';


const prisma = new PrismaClient();

/**
 * Initializes and starts the cron job for daily financial checks.
 * @param {object} io - The Socket.IO server instance for sending notifications.
 */
export function startCronJobs(io) {
    console.log('Scheduler initialized. Cron job will run daily at midnight.');

    // Schedule a task to run every day at midnight.
    cron.schedule('0 0 * * *', async () => {
        console.log('⏰ Running daily check for ended budgets...');
        try {
            const now = new Date();
            
            // 1. Find all active budgets that have now ended.
            const endedBudgets = await prisma.budget.findMany({
                where: {
                    status: 'ACTIVE',
                    endDate: { lte: now },
                },
                include: {
                    user: {
                        include: {
                            expenses: true, // Fetch all expenses for accurate filtering
                            goals: true, // Fetch goals for AI context
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
                const { user } = budget;
                
                // 2. Calculate the surplus accurately for the completed period.
                const expensesInPeriod = user.expenses.filter(
                    (exp) =>
                        new Date(exp.createdAt) >= new Date(budget.startDate) &&
                        new Date(exp.createdAt) < new Date(budget.endDate)
                );

                const totalSpent = expensesInPeriod.reduce((sum, exp) => {
                    if (exp.type === 'expense') {
                        return sum + (budget.currency === 'USD' ? (exp.amountUSD || 0) : (exp.amountNGN || 0));
                    }
                    return sum;
                }, 0);
                
                const surplus = budget.amount - totalSpent;

                // 3. Mark the processed budget as 'ENDED'.
                await prisma.budget.update({
                    where: { id: budget.id },
                    data: { status: 'ENDED' },
                });

                if (surplus > 0) {
                    console.log(`✅ User ${user.walletAddress} has a surplus of ${surplus.toFixed(2)} ${budget.currency}! Consulting AI...`);

                    // 4. Consult the AI for advice on the surplus.
                    const aiPrompt = `My ${budget.period} budget of ${budget.amount} ${budget.currency} has ended. I have a surplus of ${surplus.toFixed(2)} ${budget.currency}. Based on my goals and the market, please advise me on how to split and execute this.`;
                    
                    const intent = await parseIntent(aiPrompt, user);

                    // 5. Send an actionable push notification to the user.
                    if (intent.action === 'advise_on_surplus' || intent.action === 'execute_split') {
                        const notificationPayload = {
                            reply: intent.reply,
                            suggestions: ["Yes, execute this split.", "No, I'll decide later."],
                            intent: intent, // Pass the full intent for the frontend to act upon
                        };
                        io.to(user.walletAddress).emit('surplus_detected', notificationPayload);
                        console.log(`📬 Sent surplus detected notification to ${user.walletAddress}.`);
                    }
                } else {
                    console.log(`User ${user.walletAddress} has no surplus for this period.`);
                }

                // Handle recurring budgets
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
}
