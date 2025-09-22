import express from 'express';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID  } from '@solana/spl-token';
import { Marinade, MarinadeConfig } from '@marinade.finance/marinade-ts-sdk';
import { Liquidity, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { createJupiterApiClient } from '@jup-ag/api';
import BN from 'bn.js';
import pkg from '@prisma/client';

// Your existing modules
import { authenticateToken } from './authRoutes.js';
import { getSoltoUsdRate, getUsdtoNairaRate } from './walletListener.js';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();
const router = express.Router();
const jupiterApi = createJupiterApiClient();

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

// --- DEVNET CONSTANTS ---
const USDC_MINT_DEVNET = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
const RAY_MINT_DEVNET = new PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const MARINADE_PROGRAM_ID_DEVNET = new PublicKey('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');


async function getCurrencyValues(amount, currency) {
    const solToUsdRate = await getSoltoUsdRate();
    const usdToNgnRate = await getUsdtoNairaRate();
    if (!solToUsdRate || !usdToNgnRate) {
        throw new Error('Could not fetch all necessary conversion rates.');
    }
    
    // Calculate all three currency values based on the input
    const usdAmount = currency === 'USD' ? amount : amount / usdToNgnRate;
    const ngnAmount = currency === 'NGN' ? amount : amount * usdToNgnRate;
    const solAmount = usdAmount / solToUsdRate;

    return { solAmount, usdAmount, ngnAmount };
}

// --- SAVE ENDPOINT (Swap SOL to USDC using Raydium) ---
router.post('/save', authenticateToken, async (req, res) => {
    const { amount, currency, goalId } = req.body;
    const { walletAddress } = req.user;

    if (!amount || !currency) {
        return res.status(400).json({ error: 'Amount and currency are required.' });
    }

    try {
        const userPublicKey = new PublicKey(walletAddress);
        const { solAmount, usdAmount, ngnAmount } = await getCurrencyValues(amount, currency);
        const lamportsToSwap = new BN(Math.floor(surplusSOL * LAMPORTS_PER_SOL));

            await prisma.expense.create({
            data: {
                amount: solAmount,
                amountUSD: usdAmount,
                amountNGN: ngnAmount,
                description: "Saved surplus (SOL -> RAY/USDC)",
                category: "Savings",
                currency: "SOL",
                type: 'expense',
                userId: userId,
            }
        });

         // ✨ 2. Define tokens for Raydium SDK using RAY instead of USDC
        const solToken = new Token(TOKEN_PROGRAM_ID, SOL_MINT, 9, 'SOL', 'Solana');
        const rayToken = new Token(TOKEN_PROGRAM_ID, RAY_MINT_DEVNET, 6, 'RAY', 'Raydium');
        const amountIn = new TokenAmount(solToken, lamportsToSwap);

        // 2. Fetch all Raydium liquidity pools
        console.log('[Save Action] Fetching Raydium liquidity pools...');
        const pools = await (await fetch('https://api.raydium.io/v2/sdk/liquidity/devnet.json')).json();
        const availablePools = [...(pools.official || []), ...(pools.unOfficial || [])];
        
        // ✨ 3. Find the SOL-RAY pool info
        const poolInfo = availablePools.find(p => p.baseMint === SOL_MINT.toBase58() && p.quoteMint === RAY_MINT_DEVNET.toBase58());
        if (!poolInfo) {
             return res.status(400).json({ error: "SOL-RAY liquidity pool not found on Raydium devnet." });
        }
        console.log('[Save Action] Found SOL-RAY pool.');
        const poolKeys = {
            id: new PublicKey(poolInfo.id),
            baseMint: new PublicKey(poolInfo.baseMint),
            quoteMint: new PublicKey(poolInfo.quoteMint),
            lpMint: new PublicKey(poolInfo.lpMint),
            baseDecimals: poolInfo.baseDecimals,
            quoteDecimals: poolInfo.quoteDecimals,
            lpDecimals: poolInfo.lpDecimals,
            version: poolInfo.version,
            programId: new PublicKey(poolInfo.programId),
            authority: new PublicKey(poolInfo.authority),
            openOrders: new PublicKey(poolInfo.openOrders),
            targetOrders: new PublicKey(poolInfo.targetOrders),
            baseVault: new PublicKey(poolInfo.baseVault),
            quoteVault: new PublicKey(poolInfo.quoteVault),
            withdrawQueue: new PublicKey(poolInfo.withdrawQueue),
            lpVault: new PublicKey(poolInfo.lpVault),
            marketVersion: 3,
            marketProgramId: new PublicKey(poolInfo.marketProgramId),
            marketId: new PublicKey(poolInfo.marketId),
            marketAuthority: new PublicKey(poolInfo.marketAuthority),
            marketBaseVault: new PublicKey(poolInfo.marketBaseVault),
            marketQuoteVault: new PublicKey(poolInfo.marketQuoteVault),
            marketBids: new PublicKey(poolInfo.marketBids),
            marketAsks: new PublicKey(poolInfo.marketAsks),
            marketEventQueue: new PublicKey(poolInfo.marketEventQueue),
        };

        // 3. Prepare the swap transaction
        const { setupTransaction, swapTransaction } = await Liquidity.makeSwapTransaction({
            connection,
            poolKeys,
            userKeys: { owner: userPublicKey, tokenAccounts: [] }, // SDK will find accounts
            amountIn,
            amountOut: new TokenAmount(usdcToken, new BN(0)), // Min amount out
            fixedSide: 'in',
        });

        // 4. Combine transactions and send to frontend
        const latestBlockhash = await connection.getLatestBlockhash();
        const messageV0 = new TransactionMessage({
            payerKey: userPublicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [
                ...(setupTransaction ? setupTransaction.instructions : []),
                ...swapTransaction.instructions
            ],
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);

        // 3. Update Goal Logic (if goalId is provided)
        if (goalId) {
            const goal = await prisma.goal.findUnique({ where: { id: goalId } });
            if (goal) {
                // Now uses the pre-calculated usdAmount and ngnAmount
                const amountToAdd = goal.currency === 'USD' ? usdAmount : ngnAmount;
                await prisma.goal.update({
                    where: { id: goalId },
                    data: { currentAmount: { increment: amountToAdd } }
                });
            }
        }
        
        // 4. Serialize the final transaction and send to frontend
        const serializedTransaction = Buffer.from(transaction.serialize());

        return res.json({
            success: true,
            message: 'Save transaction ready for signing.',
            transaction: serializedTransaction.toString('base64'),
        });

    } catch (err) {
        console.error("🔴 FATAL SAVE ACTION ERROR:", err);
        return res.status(500).json({ 
            error: 'Failed to prepare save transaction on the server.',
            detail: err.message 
        });
    }
});


// --- STAKE ENDPOINT (Marinade SOL -> mSOL) ---
router.post('/stake', authenticateToken, async (req, res) => {
    const { amount, currency, goalId } = req.body;
    const { userId, walletAddress } = req.user;
    
    if (!amount || !currency) {
        return res.status(400).json({ error: 'Amount and currency are required.' });
    }

    try {
        const userPublicKey = new PublicKey(walletAddress);

        // Use the correct helper and variable names
        const { solAmount, usdAmount, ngnAmount } = await getCurrencyValues(amount, currency);
        const lamportsToStake = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
        
       

        // --- Marinade SDK Logic ---
        const config = new MarinadeConfig({
            connection: connection,
            publicKey: userPublicKey,
            marinadeFinanceProgramId: MARINADE_PROGRAM_ID_DEVNET,
        });
        const marinade = new Marinade(config);
        const { transaction } = await marinade.deposit(lamportsToStake);
        
        // --- Update Goal Logic ---
        
        
        // ✨ FIX: Complete the transaction finalization and serialization logic.
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = userPublicKey;

        const serializedTransaction = transaction.serialize({
            requireAllSignatures: false, // User's wallet will sign
        });

        return res.json({
            success: true,
            message: 'Staking transaction ready for signing.',
            transaction: serializedTransaction.toString('base64'),
        });

    } catch (err) {
        console.error("🔴 FATAL STAKE ACTION ERROR:", err);
        return res.status(500).json({ 
            error: 'Failed to prepare stake transaction.',
            detail: err.message 
        });
    }
});

// ✨ --- NEW: CONFIRMATION ENDPOINT --- ✨
router.post('/confirm-action', authenticateToken, async (req, res) => {
    const { txSig, action, goalId, amount, currency } = req.body;
    const { userId } = req.user;

    if (!txSig || !action || !amount || !currency) {
        return res.status(400).json({ error: 'Missing required confirmation data.' });
    }

    try {
        // Give the wallet listener a moment to potentially see the transaction first.
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3-second delay

        const description = action === 'save' ? 'Saved surplus (SOL -> RAY)' : 'Staked surplus (SOL -> mSOL)';
        const category = action === 'save' ? 'Savings' : 'Staking';

        const { usdAmount, ngnAmount, solAmount } = await getCurrencyValues(amount, currency);

        // Use prisma.upsert to either update the listener's record or create a new one.
        // This is the core of the race condition fix.
        await prisma.expense.upsert({
            where: { txSig: txSig },
            update: {
                description: description,
                category: category,
                // The listener might not have conversion rates, so we ensure they are set.
                amountUSD: usdAmount,
                amountNGN: ngnAmount,
            },
            create: {
                txSig: txSig,
                description: description,
                category: category,
                amount: solAmount,
                amountUSD: usdAmount,
                amountNGN: ngnAmount,
                currency: 'SOL',
                type: 'expense',
                userId: userId,
            }
        });

        // Update goal progress (this logic is the same as before)
        if (goalId) {
            const goal = await prisma.goal.findUnique({ where: { id: goalId } });
            if (goal) {
                const amountToAdd = goal.currency === 'USD' ? usdAmount : ngnAmount;
                await prisma.goal.update({
                    where: { id: goalId },
                    data: { currentAmount: { increment: amountToAdd } }
                });
            }
        }

        return res.json({ success: true, message: 'Action confirmed and recorded.' });

    } catch (err) {
        console.error("🔴 FATAL CONFIRM ACTION ERROR:", err);
        return res.status(500).json({
            error: 'Failed to confirm action on the server.',
            detail: err.message
        });
    }
});


export default router;
