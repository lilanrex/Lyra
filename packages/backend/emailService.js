import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// 1. Configure the email transporter using credentials from your .env file
const transporter = nodemailer.createTransport({
    service: 'gmail', // Or another service like SendGrid, Mailgun, etc.
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});


// Verify the connection
transporter.verify((error, success) => {
    if (error) {
        console.error('[Email Service] SMTP connection failed:', error);
    } else {
        console.log('[Email Service] SMTP server is ready to send emails');
    }
});
/**
 * Creates a visually appealing HTML body for the transaction notification email.
 * @param {object} tx - The transaction details from your database.
 * @param {string} userName - The user's name.
 * @returns {string} - The HTML content for the email.
 */
function createEmailHtml(tx, userName) {
    const isExpense = tx.type === 'expense';
    const amountColor = isExpense ? '#ef4444' : '#22c55e'; // Red for expense, green for income
    const currency = tx.currency || 'N/A';
    // Use the most relevant fiat currency for display, defaulting to USD
    const fiatAmount = tx.amountUSD ? `$${tx.amountUSD.toFixed(2)} USD` : (tx.amountNGN ? `₦${tx.amountNGN.toFixed(2)} NGN` : '');

    return `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #27272a; border-radius: 8px; padding: 20px; background-color: #09090b; color: #e4e4e7;">
            <h1 style="color: #a78bfa; font-size: 24px; text-align: center;">LyraAI Transaction Alert</h1>
            <p style="font-size: 16px;">Hi ${userName || 'there'},</p>
            <p style="font-size: 16px;">We've detected a new transaction in your connected wallet:</p>
            <div style="background-color: #18181b; border-radius: 8px; padding: 16px; margin-top: 20px;">
                <p style="margin: 0; font-size: 28px; font-weight: bold; color: ${amountColor}; text-align: center;">
                    ${isExpense ? '-' : '+'}${tx.amount.toFixed(4)} ${currency}
                </p>
                <p style="text-align: center; color: #a1a1aa; font-size: 16px; margin: 4px 0 0;">
                    ~ ${fiatAmount}
                </p>
            </div>
            <table style="width: 100%; margin-top: 20px; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #27272a;">
                    <td style="padding: 8px; color: #a1a1aa;">Description:</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold;">${tx.description}</td>
                </tr>
                <tr style="border-bottom: 1px solid #27272a;">
                    <td style="padding: 8px; color: #a1a1aa;">Category:</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold;">${tx.category}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; color: #a1a1aa;">Date:</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold;">${new Date(tx.date).toLocaleString()}</td>
                </tr>
            </table>
            <p style="font-size: 12px; color: #52525b; text-align: center; margin-top: 30px;">
                This is an automated notification from your LyraAI Financial Assistant.
            </p>
        </div>
    `;
}


/**
 * Sends a transaction notification email to a user.
 * @param {object} user - The user object, must contain 'email' and 'name'.
 * @param {object} transaction - The transaction details.
 */
export async function sendTransactionNotification(user, transaction) {
    const recipientEmail = user?.email || "joshoct1902@gmail.com";

    // Log a warning if we're using the fallback email
    if (!user?.email) {
        console.warn(`[Email Service] User email not found for wallet ${user?.walletAddress || 'N/A'}. Using hardcoded fallback address for testing.`);
    }

    const mailOptions = {
        from: `"LyraAI Notifier" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: `LyraAI Transaction Alert: ${transaction.type === 'expense' ? '-' : '+'}${transaction.amount.toFixed(2)} ${transaction.currency}`,
        html: createEmailHtml(transaction, user?.name),
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[Email Service] Transaction notification sent to ${user.email}`);
    } catch (error) {
        console.error(`[Email Service] Failed to send email to ${user.email}:`, error);
    }
}