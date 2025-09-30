import express from 'express';
import PDFDocument from 'pdfkit';
import pkg from '@prisma/client';
import { authenticateToken } from './authRoutes.js';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();
const router = express.Router();



router.get('/reactivate-latest-budget', async (req, res) => {
    // ✨ FIX: Replace this with your wallet address for testing.
    const walletAddressForTesting = "AhwajZbujd6E28iD2Di7FkPwKW64dWqHSN3WAMGaJj27";

    try {
        const user = await prisma.user.findUnique({
            where: { walletAddress: walletAddressForTesting },
        });

        if (!user) {
            return res.status(404).json({ error: `User with wallet ${walletAddressForTesting} not found.` });
        }

        const latestBudget = await prisma.budget.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        if (!latestBudget) {
            return res.status(404).json({ error: "No budget found for this user to reactivate." });
        }

        const updatedBudget = await prisma.budget.update({
            where: { id: latestBudget.id },
            data: { status: 'ACTIVE' }
        });

        console.log(`[Test Util] Budget ${updatedBudget.id} has been manually set to ACTIVE.`);
        return res.json({ 
            success: true, 
            message: `Budget ${updatedBudget.id} for wallet ${walletAddressForTesting} has been reactivated for testing.`,
            budget: updatedBudget
        });

    } catch (error) {
        console.error("Failed to reactivate budget:", error);
        return res.status(500).json({ error: "Failed to reactivate budget." });
    }
});
// GET /api/reports/weekly-summary

router.get('/financials/:wallet', authenticateToken, async (req, res) => {
    const { wallet } = req.params;

    try {
        // ✨ FIX: The query is now broken into two steps for correctness and clarity.
        
        // Step 1: Find the user by their wallet address.
        const user = await prisma.user.findUnique({
            where: { walletAddress: wallet }
        });

        if (!user) {
            return res.status(404).json({ success: false, error: "User not found." });
        }

        // Step 2: Find the user's most recent budget record.
        const latestBudget = await prisma.budget.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        if (!latestBudget) {
            return res.json({ success: true, surplus: 0, budget: null, reason: "No budget has been set up yet." });
        }
        
        console.log('[Financials Endpoint] Found latest budget:', {
            id: latestBudget.id,
            amount: latestBudget.amount,
            currency: latestBudget.currency,
            startDate: latestBudget.startDate,
            endDate: latestBudget.endDate,
            status: latestBudget.status
        });

        const spendingAggregation = await prisma.expense.aggregate({
            where: {
                userId: user.id,
                type: 'expense',
                createdAt: {
                    gte: new Date(latestBudget.startDate),
                    lt: new Date(latestBudget.endDate)
                }
            },
            _sum: {
                amountUSD: latestBudget.currency === 'USD' ? true : undefined,
                amountNGN: latestBudget.currency === 'NGN' ? true : undefined,
            }
        });
        
        const totalSpent = (latestBudget.currency === 'USD' 
            ? spendingAggregation._sum.amountUSD 
            : spendingAggregation._sum.amountNGN) || 0;

        const surplus = latestBudget.amount - totalSpent;

        console.log('[Financials Endpoint] Calculation:', {
            totalSpent: totalSpent,
            surplus: surplus > 0 ? surplus : 0
        });

        return res.json({
            success: true,
            surplus: surplus > 0 ? surplus : 0,
            totalSpent: totalSpent,
            budget: {
                amount: latestBudget.amount,
                currency: latestBudget.currency,
                startDate: latestBudget.startDate,
                endDate: latestBudget.endDate
            }
        });

    } catch (error) {
        console.error("Failed to fetch financials:", error);
        res.status(500).json({ success: false, error: "Failed to fetch financial data." });
    }
});

router.get('/weekly-summary', authenticateToken, async (req, res) => {
    const { userId, walletAddress } = req.user;

    try {
        // 1. Fetch user, budget, and recent transactions
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const userWithData = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                budget: true,
                goals: true,
                expenses: {
                    where: {
                        createdAt: { gte: sevenDaysAgo }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!userWithData) {
            return res.status(404).json({ error: "User not found." });
        }

        const { name, budget, expenses, goals } = userWithData;
        const reportCurrency = budget?.currency || 'USD';
        const currencySymbol = reportCurrency === 'USD' ? '$' : '₦';

        // 2. Set up the PDF document with better margins
        const doc = new PDFDocument({ 
            margin: 60, 
            size: 'A4',
            info: {
                Title: 'LyraAI Weekly Financial Report',
                Author: 'LyraAI',
                Subject: 'Weekly Financial Summary'
            }
        });

        const filename = `LyraAI_Weekly_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // Color palette for consistency
        const colors = {
            primary: '#2563eb',
            success: '#10b981',
            danger: '#ef4444',
            warning: '#f59e0b',
            gray900: '#111827',
            gray700: '#374151',
            gray500: '#6b7280',
            gray300: '#d1d5db',
            gray100: '#f3f4f6',
            white: '#ffffff'
        };

        // Helper functions
        function addWatermark(doc) {
            doc.save();
            doc.rotate(45, { origin: [300, 400] });
            doc.fontSize(80)
               .font('Helvetica-Bold')
               .fillColor(colors.gray100, 0.15)
               .text('LYRA AI', 100, 250, {
                   align: 'center',
                   width: 400
               });
            doc.restore();
        }

        function drawCard(doc, x, y, width, height, fillColor = colors.white, strokeColor = colors.gray300) {
            doc.save();
            doc.roundedRect(x, y, width, height, 8)
               .fillAndStroke(fillColor, strokeColor);
            doc.restore();
            return { x: x + 16, y: y + 16, contentWidth: width - 32, contentHeight: height - 32 };
        }

        function addSectionHeader(doc, title, icon = '') {
            const currentY = doc.y;
            doc.fontSize(18)
               .font('Helvetica-Bold')
               .fillColor(colors.gray900)
               .text(`${icon} ${title}`, 60, currentY);
            
            // Add underline
            doc.moveTo(60, currentY + 25)
               .lineTo(535, currentY + 25)
               .stroke(colors.primary);
            
            doc.y = currentY + 40;
        }

        // Add watermark
        addWatermark(doc);

        // --- HEADER SECTION ---
        const headerCard = drawCard(doc, 60, 60, 475, 120, colors.primary);
        
        doc.fontSize(28)
           .font('Helvetica-Bold')
           .fillColor(colors.white)
           .text('LyraAI', headerCard.x, headerCard.y, { align: 'center', width: headerCard.contentWidth });
        
        doc.fontSize(16)
           .font('Helvetica')
           .text('Weekly Financial Report', headerCard.x, headerCard.y + 35, { align: 'center', width: headerCard.contentWidth });
        
        doc.fontSize(12)
           .fillColor('#e0e7ff')
           .text(`${sevenDaysAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}`, 
                  headerCard.x, headerCard.y + 60, { align: 'center', width: headerCard.contentWidth });
        
        doc.fontSize(10)
           .text(`Report for: ${name || walletAddress}`, 
                  headerCard.x, headerCard.y + 80, { align: 'center', width: headerCard.contentWidth });

        doc.y = 200;

        // --- FINANCIAL SUMMARY SECTION ---
        addSectionHeader(doc, 'Financial Overview');

        // Calculate totals
        let totalIncome = 0;
        let totalExpenses = 0;
        const categoryBreakdown = {};

        expenses.forEach(tx => {
            const amount = reportCurrency === 'USD' ? (tx.amountUSD || 0) : (tx.amountNGN || 0);
            if (tx.type === 'income') {
                totalIncome += amount;
            } else if (tx.type === 'expense') {
                totalExpenses += amount;
                const category = tx.category || 'Other';
                categoryBreakdown[category] = (categoryBreakdown[category] || 0) + amount;
            }
        });

        const netFlow = totalIncome - totalExpenses;
        const budgetUsed = budget?.totalBudget ? (totalExpenses / budget.totalBudget) * 100 : 0;

        // Summary cards layout
        const cardWidth = 145;
        const cardHeight = 100;
        const cardSpacing = 20;
        const startX = 60;
        let cardY = doc.y;

        // Income card
        const incomeCard = drawCard(doc, startX, cardY, cardWidth, cardHeight, colors.white, colors.success);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.success)
           .text('Total Income', incomeCard.x, incomeCard.y);
        doc.fontSize(24).fillColor(colors.gray900)
           .text(`${currencySymbol}${totalIncome.toLocaleString()}`, incomeCard.x, incomeCard.y + 25);
        doc.fontSize(10).fillColor(colors.gray500)
           .text(`${expenses.filter(tx => tx.type === 'income').length} transactions`, incomeCard.x, incomeCard.y + 60);

        // Expenses card
        const expensesCard = drawCard(doc, startX + cardWidth + cardSpacing, cardY, cardWidth, cardHeight, colors.white, colors.danger);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(colors.danger)
           .text('Total Expenses', expensesCard.x, expensesCard.y);
        doc.fontSize(24).fillColor(colors.gray900)
           .text(`${currencySymbol}${totalExpenses.toLocaleString()}`, expensesCard.x, expensesCard.y + 25);
        doc.fontSize(10).fillColor(colors.gray500)
           .text(`${expenses.filter(tx => tx.type === 'expense').length} transactions`, expensesCard.x, expensesCard.y + 60);

        // Net Flow card
        const netColor = netFlow >= 0 ? colors.success : colors.danger;
        const netCard = drawCard(doc, startX + (cardWidth + cardSpacing) * 2, cardY, cardWidth, cardHeight, colors.white, netColor);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(netColor)
           .text('Net Flow', netCard.x, netCard.y);
        doc.fontSize(24).fillColor(colors.gray900)
           .text(`${currencySymbol}${netFlow.toLocaleString()}`, netCard.x, netCard.y + 25);
        doc.fontSize(10).fillColor(colors.gray500)
           .text(netFlow >= 0 ? 'Surplus' : 'Deficit', netCard.x, netCard.y + 60);

        doc.y = cardY + cardHeight + 40;

        // Budget utilization if available
        if (budget?.totalBudget && budget.totalBudget > 0) {
            const budgetCard = drawCard(doc, 60, doc.y, 475, 80, colors.gray100);
            
            doc.fontSize(14).font('Helvetica-Bold').fillColor(colors.gray900)
               .text('Budget Utilization', budgetCard.x, budgetCard.y);
            
            const progressBarWidth = 300;
            const progressBarHeight = 12;
            const progressBarY = budgetCard.y + 30;
            const usedWidth = Math.min((budgetUsed / 100) * progressBarWidth, progressBarWidth);
            const progressColor = budgetUsed > 100 ? colors.danger : budgetUsed > 80 ? colors.warning : colors.success;
            
            // Progress bar background
            doc.roundedRect(budgetCard.x, progressBarY, progressBarWidth, progressBarHeight, 6)
               .fill(colors.gray300);
            
            // Progress bar fill
            if (usedWidth > 0) {
                doc.roundedRect(budgetCard.x, progressBarY, usedWidth, progressBarHeight, 6)
                   .fill(progressColor);
            }
            
            doc.fontSize(11).fillColor(colors.gray700)
               .text(`${currencySymbol}${totalExpenses.toLocaleString()} of ${currencySymbol}${budget.totalBudget.toLocaleString()} (${budgetUsed.toFixed(1)}%)`, 
                      budgetCard.x + progressBarWidth + 20, progressBarY + 2);
            
            doc.y = budgetCard.y + 90;
        }

        // --- TRANSACTIONS SECTION ---
        addSectionHeader(doc, 'Weekly Transactions');

        if (expenses && expenses.length > 0) {
            const transactionCard = drawCard(doc, 60, doc.y, 475, Math.min(expenses.length * 25 + 60, 400), colors.white);
            
            // Table header
            const headerY = transactionCard.y;
            doc.rect(transactionCard.x, headerY, transactionCard.contentWidth, 30)
               .fill(colors.gray100);
            
            doc.fontSize(11).font('Helvetica-Bold').fillColor(colors.gray700);
            const cols = [
                { label: 'Date', x: transactionCard.x + 10, width: 70 },
                { label: 'Description', x: transactionCard.x + 90, width: 120 },
                { label: 'Category', x: transactionCard.x + 220, width: 80 },
                { label: 'Type', x: transactionCard.x + 310, width: 60 },
                { label: 'Amount', x: transactionCard.x + 380, width: 70 }
            ];
            
            cols.forEach(col => {
                doc.text(col.label, col.x, headerY + 10);
            });

            // Transaction rows
            let rowY = headerY + 35;
            const displayTransactions = expenses.slice(0, 12);
            
            displayTransactions.forEach((tx, index) => {
                const amount = reportCurrency === 'USD' ? (tx.amountUSD || 0) : (tx.amountNGN || 0);
                const typeColor = tx.type === 'income' ? colors.success : colors.danger;
                
                // Alternating row background
                if (index % 2 === 0) {
                    doc.rect(transactionCard.x, rowY - 5, transactionCard.contentWidth, 25)
                       .fill('#fafafa');
                }
                
                doc.fontSize(9).font('Helvetica').fillColor(colors.gray700);
                
                // Date
                doc.text(new Date(tx.date).toLocaleDateString('en-US', { 
                    month: 'short', day: 'numeric' 
                }), cols[0].x, rowY);
                
                // Description
                const description = (tx.description || 'N/A').substring(0, 20);
                doc.text(description, cols[1].x, rowY);
                
                // Category
                doc.text((tx.category || 'Other').substring(0, 12), cols[2].x, rowY);
                
                // Type
                doc.fillColor(typeColor).text(tx.type, cols[3].x, rowY);
                
                // Amount
                doc.fillColor(typeColor).font('Helvetica-Bold')
                   .text(`${currencySymbol}${amount.toLocaleString()}`, cols[4].x, rowY);
                
                rowY += 25;
            });
            
            if (expenses.length > 12) {
                doc.fontSize(10).font('Helvetica').fillColor(colors.gray500)
                   .text(`+ ${expenses.length - 12} more transactions`, transactionCard.x + 10, rowY + 10);
            }
            
            doc.y = Math.max(rowY + 30, transactionCard.y + transactionCard.contentHeight + 20);
        } else {
            const emptyCard = drawCard(doc, 60, doc.y, 475, 80, colors.gray100);
            doc.fontSize(14).fillColor(colors.gray500)
               .text('No transactions found for this period', emptyCard.x, emptyCard.y + 25, {
                   align: 'center', width: emptyCard.contentWidth
               });
            doc.y = emptyCard.y + 90;
        }

        // --- GOALS SECTION ---
        if (goals && goals.length > 0) {
            addSectionHeader(doc, 'Goal Progress');
            
            const goalsCard = drawCard(doc, 60, doc.y, 475, goals.length * 70 + 40, colors.white);
            let goalY = goalsCard.y + 10;
            
            goals.forEach(goal => {
                const progress = Math.min((goal.currentAmount / goal.targetAmount) * 100, 100);
                const progressColor = progress >= 80 ? colors.success : progress >= 50 ? colors.warning : colors.danger;
                
                doc.fontSize(13).font('Helvetica-Bold').fillColor(colors.gray900)
                   .text(goal.name, goalsCard.x, goalY);
                
                doc.fontSize(10).font('Helvetica').fillColor(colors.gray600)
                   .text(`${goal.type} • Target: ${currencySymbol}${goal.targetAmount.toLocaleString()}`, 
                          goalsCard.x, goalY + 18);
                
                // Progress bar
                const progressBarY = goalY + 35;
                const progressBarWidth = 200;
                const progressBarHeight = 8;
                const filledWidth = (progress / 100) * progressBarWidth;
                
                doc.roundedRect(goalsCard.x, progressBarY, progressBarWidth, progressBarHeight, 4)
                   .fill(colors.gray300);
                
                if (filledWidth > 0) {
                    doc.roundedRect(goalsCard.x, progressBarY, filledWidth, progressBarHeight, 4)
                       .fill(progressColor);
                }
                
                doc.fontSize(11).fillColor(colors.gray700)
                   .text(`${currencySymbol}${goal.currentAmount.toLocaleString()} (${progress.toFixed(1)}%)`, 
                          goalsCard.x + progressBarWidth + 20, progressBarY - 2);
                
                goalY += 60;
            });
            
            doc.y = goalsCard.y + goalsCard.contentHeight + 30;
        }

        
  // --- FOOTER ---
        // Add spacing before footer
        doc.y += 40;
        
        // Check if we need a new page for the footer
        const pageHeight = 792; // A4 page height in points
        const footerHeight = 40;
        const bottomMargin = 60;
        
        if (doc.y + footerHeight > pageHeight - bottomMargin) {
            doc.addPage();
            addWatermark(doc);
            doc.y = pageHeight - bottomMargin - footerHeight;
        }
        
        // Position footer at current Y or bottom of page, whichever is higher
        const footerY = Math.max(doc.y, pageHeight - bottomMargin - footerHeight);
        
        doc.fontSize(9).fillColor(colors.gray500)
           .text('Generated by LyraAI Financial Assistant', 60, footerY, { align: 'center', width: 475 })
           .text(`Report generated on ${new Date().toLocaleString()}`, 60, footerY + 15, { align: 'center', width: 475 });

        doc.end();

    } catch (error) {
        console.error("Failed to generate PDF report:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to generate PDF report" });
        }
    }
});

export default router;