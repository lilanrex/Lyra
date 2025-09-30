import express from 'express';
import { 
    Connection, 
    PublicKey, 
    LAMPORTS_PER_SOL, 
    Transaction, 
    VersionedTransaction, 
    SystemProgram, 
    StakeProgram, 
    Authorized, 
    Keypair, 
    TransactionMessage 
} from '@solana/web3.js';
import { 
    getAssociatedTokenAddress, 
    createAssociatedTokenAccountInstruction, 
    TOKEN_PROGRAM_ID,
    createTransferInstruction,
    getAccount
} from '@solana/spl-token';
import BN from 'bn.js';
import pkg from '@prisma/client';

// Your existing modules
import { authenticateToken } from './authRoutes.js';
import { getSoltoUsdRate, getUsdtoNairaRate } from './walletListener.js';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();
const router = express.Router();

// Force devnet connection - don't rely on env variable for testing
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Verify we're on devnet
console.log('🌐 Connected to:', connection.rpcEndpoint);

// Function to verify network
async function verifyNetwork() {
    try {
        const genesisHash = await connection.getGenesisHash();
        // Devnet genesis hash
        const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        
        if (genesisHash !== DEVNET_GENESIS) {
            console.error('❌ NOT CONNECTED TO DEVNET!');
            console.error('Current genesis:', genesisHash);
            console.error('Expected devnet:', DEVNET_GENESIS);
            return false;
        }
        
        console.log('✅ Verified devnet connection');
        return true;
    } catch (error) {
        console.error('Failed to verify network:', error);
        return false;
    }
}

// Verify network on startup
verifyNetwork();

// --- VERIFIED DEVNET CONSTANTS ---
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // Same on all networks
// Verified devnet USDC mint
const USDC_MINT_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// Function to get an active devnet validator
async function getActiveValidator() {
    try {
        const voteAccounts = await connection.getVoteAccounts();
        
        if (voteAccounts.current.length === 0) {
            throw new Error('No active validators found on devnet');
        }
        
        // Sort by stake (descending) and pick one with good performance
        const sortedValidators = voteAccounts.current
            .filter(v => v.activatedStake > 0) // Only validators with stake
            .sort((a, b) => b.activatedStake - a.activatedStake);
            
        if (sortedValidators.length === 0) {
            throw new Error('No validators with active stake found');
        }
        
        const selectedValidator = new PublicKey(sortedValidators[0].votePubkey);
        console.log('✅ Selected active validator:', selectedValidator.toBase58());
        console.log('📊 Validator stake:', sortedValidators[0].activatedStake);
        
        return selectedValidator;
    } catch (error) {
        console.error('Failed to get active validator:', error);
        // Fallback to a known devnet validator (may not be active)
        return new PublicKey('dv4ACNkpYPcE3aKmYDqZm9G5EB3J4MRoeE7WNDRBVJB');
    }
}

async function getCurrencyValues(amount, currency) {
    const solToUsdRate = await getSoltoUsdRate();
    const usdToNgnRate = await getUsdtoNairaRate();
    if (!solToUsdRate || !usdToNgnRate) {
        throw new Error('Could not fetch all necessary conversion rates.');
    }
    
    const usdAmount = currency === 'USD' ? amount : amount / usdToNgnRate;
    const ngnAmount = currency === 'NGN' ? amount : amount * usdToNgnRate;
    const solAmount = usdAmount / solToUsdRate;

    return { solAmount, usdAmount, ngnAmount };
}

// --- SIMPLIFIED SAVE ENDPOINT (Transfer to savings wallet instead of swap) ---
router.post('/save', authenticateToken, async (req, res) => {
    const { amount, currency } = req.body;
    const { walletAddress } = req.user;

    if (!amount || !currency) {
        return res.status(400).json({ error: 'Amount and currency are required.' });
    }

    try {
        // Verify we're on devnet
        const isDevnet = await verifyNetwork();
        if (!isDevnet) {
            return res.status(500).json({ 
                error: 'Server is not connected to devnet. Please check configuration.' 
            });
        }

        const userPublicKey = new PublicKey(walletAddress);
        const { solAmount } = await getCurrencyValues(amount, currency);
        const lamportsToSave = Math.floor(solAmount * LAMPORTS_PER_SOL);

        // Create a deterministic savings wallet based on user's wallet
        // This ensures the same savings address is used each time
        const savingsWallet = new PublicKey('11111111111111111111111111111112'); // System program for testing
        
        // For real implementation, you might want to derive a PDA:
        // const [savingsWallet] = await PublicKey.findProgramAddress(
        //     [Buffer.from("savings"), userPublicKey.toBuffer()],
        //     new PublicKey("YourProgramId")
        // );

        // Check if user has sufficient balance
        const balance = await connection.getBalance(userPublicKey);
        const estimatedFee = 5000; // 0.000005 SOL
        
        if (balance < lamportsToSave + estimatedFee) {
            return res.status(400).json({ 
                error: `Insufficient SOL balance. Need ${(lamportsToSave + estimatedFee) / LAMPORTS_PER_SOL} SOL, have ${balance / LAMPORTS_PER_SOL} SOL.` 
            });
        }

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: userPublicKey,
                toPubkey: savingsWallet,
                lamports: lamportsToSave,
            })
        );

        const { blockhash } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userPublicKey;

        const serializedTransaction = transaction.serialize({ 
            requireAllSignatures: false, 
            verifySignatures: false 
        });

        console.log('✅ Save transaction prepared for devnet');
        console.log('📊 Amount:', solAmount, 'SOL');
        console.log('🎯 To:', savingsWallet.toBase58());

        return res.json({
            success: true,
            message: 'Save transaction ready for signing on DEVNET.',
            transaction: serializedTransaction.toString('base64'),
            network: 'devnet',
            savingsWallet: savingsWallet.toBase58(),
            details: {
                amount: solAmount,
                lamports: lamportsToSave,
                currency: currency,
                network: 'devnet'
            }
        });

    } catch (err) {
        console.error("🔴 SAVE ACTION ERROR:", err);
        return res.status(500).json({ 
            error: 'Failed to prepare save transaction.',
            detail: err.message 
        });
    }
});

// --- FIXED STAKE ENDPOINT ---
router.post('/stake', authenticateToken, async (req, res) => {
    const { amount, currency } = req.body;
    const { walletAddress } = req.user;
    
    if (!amount || !currency) {
        return res.status(400).json({ error: 'Amount and currency are required.' });
    }

    try {
        // Verify we're on devnet
        const isDevnet = await verifyNetwork();
        if (!isDevnet) {
            return res.status(500).json({ 
                error: 'Server is not connected to devnet. Please check configuration.' 
            });
        }

        const userPublicKey = new PublicKey(walletAddress);
        const { solAmount } = await getCurrencyValues(amount, currency);
        
        const lamportsToStake = Math.floor(solAmount * LAMPORTS_PER_SOL);
        const minimumRent = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
        
        if (lamportsToStake < minimumRent) {
            return res.status(400).json({ 
                error: `Minimum stake amount is ${(minimumRent / LAMPORTS_PER_SOL).toFixed(6)} SOL for rent exemption.` 
            });
        }

        // Check user balance
        const balance = await connection.getBalance(userPublicKey);
        const estimatedFee = 10000; // 0.00001 SOL
        
        if (balance < lamportsToStake + estimatedFee) {
            return res.status(400).json({ 
                error: `Insufficient SOL balance. Need ${(lamportsToStake + estimatedFee) / LAMPORTS_PER_SOL} SOL, have ${balance / LAMPORTS_PER_SOL} SOL.` 
            });
        }

        const stakeAccountKeypair = Keypair.generate();

        // Get an active validator dynamically
        const activeValidator = await getActiveValidator();
        console.log('🎯 Using validator:', activeValidator.toBase58());

        
        const transaction = new Transaction().add(
            // Create stake account
            SystemProgram.createAccount({
                fromPubkey: userPublicKey,
                newAccountPubkey: stakeAccountKeypair.publicKey,
                lamports: lamportsToStake,
                space: StakeProgram.space,
                programId: StakeProgram.programId,
            }),
            // Initialize stake account
            StakeProgram.initialize({
                stakePubkey: stakeAccountKeypair.publicKey,
                authorized: new Authorized(userPublicKey, userPublicKey),
            }),
            // Delegate stake to active validator
            StakeProgram.delegate({
                stakePubkey: stakeAccountKeypair.publicKey,
                authorizedPubkey: userPublicKey,
                votePubkey: activeValidator,
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userPublicKey;
        
        // Partially sign with the stake account keypair
        transaction.partialSign(stakeAccountKeypair);

        const serializedTransaction = transaction.serialize({ 
            requireAllSignatures: false 
        });

        console.log('✅ Stake transaction prepared for devnet');
        console.log('📊 Amount:', solAmount, 'SOL');
        console.log('🏛️ Validator:', activeValidator.toBase58());

        return res.json({
            success: true,
            message: 'Staking transaction ready for signing on DEVNET.',
            transaction: serializedTransaction.toString('base64'),
            network: 'devnet',
            stakeAccount: stakeAccountKeypair.publicKey.toBase58(),
            details: {
                amount: solAmount,
                lamports: lamportsToStake,
                validator: activeValidator.toBase58(),
                currency: currency,
                network: 'devnet'
            }
        });

    } catch (err) {
        console.error("🔴 STAKE ACTION ERROR:", err);
        return res.status(500).json({ 
            error: 'Failed to prepare stake transaction.',
            detail: err.message 
        });
    }
});

// --- IMPROVED CONFIRMATION ENDPOINT ---
router.post('/confirm-action', authenticateToken, async (req, res) => {
    const { txSig, action, goalId, amount, currency } = req.body;
    const { userId } = req.user;

    if (typeof txSig !== 'string' || txSig.trim() === '') {
        return res.status(400).json({ error: 'A valid transaction signature is required.' });
    }

    try {
        // Verify transaction exists on chain
        let txInfo;
        let retries = 0;
        const maxRetries = 10;
        
        while (retries < maxRetries) {
            try {
                txInfo = await connection.getTransaction(txSig, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0
                });
                if (txInfo) break;
            } catch (error) {
                console.log(`Transaction not found, retry ${retries + 1}/${maxRetries}`);
            }
            
            retries++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!txInfo) {
            return res.status(400).json({ 
                error: 'Transaction not found on blockchain after verification attempts.' 
            });
        }

        if (txInfo.meta?.err) {
            return res.status(400).json({ 
                error: 'Transaction failed on blockchain.',
                detail: txInfo.meta.err
            });
        }

        const description = action === 'save' ? 'Saved surplus (SOL Transfer)' : 'Staked surplus (Native Staking)';
        const category = action === 'save' ? 'Savings' : 'Staking';

        const { usdAmount, ngnAmount, solAmount } = await getCurrencyValues(amount, currency);

        // Record the transaction
        await prisma.expense.upsert({
            where: { txSig: txSig },
            update: {
                description: description,
                category: category,
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

        // Update goal if specified
        if (goalId) {
            const goal = await prisma.goal.findUnique({ where: { id: parseInt(goalId) } });
            if (goal) {
                const amountToAdd = currency === 'USD' ? usdAmount : ngnAmount;
                await prisma.goal.update({
                    where: { id: parseInt(goalId) },
                    data: { currentAmount: { increment: amountToAdd } }
                });
            }
        }

        return res.json({ 
            success: true, 
            message: 'Action confirmed and recorded.',
            transactionDetails: {
                signature: txSig,
                slot: txInfo.slot,
                blockTime: txInfo.blockTime,
                fee: txInfo.meta.fee
            }
        });

    } catch (err) {
        console.error("🔴 CONFIRM ACTION ERROR:", err);
        return res.status(500).json({
            error: 'Failed to confirm action on the server.',
            detail: err.message
        });
    }
});

// --- UTILITY ENDPOINTS ---

// Check devnet balance
router.get('/devnet-balance', authenticateToken, async (req, res) => {
    const { walletAddress } = req.user;
    
    try {
        const publicKey = new PublicKey(walletAddress);
        const balance = await connection.getBalance(publicKey);
        
        return res.json({
            success: true,
            balance: {
                lamports: balance,
                sol: balance / LAMPORTS_PER_SOL
            },
            network: 'devnet'
        });
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to check devnet balance.',
            detail: err.message
        });
    }
});

// Check available validators
router.get('/validators', async (req, res) => {
    try {
        const voteAccounts = await connection.getVoteAccounts();
        
        const activeValidators = voteAccounts.current
            .filter(v => v.activatedStake > 0)
            .sort((a, b) => b.activatedStake - a.activatedStake)
            .slice(0, 10) // Top 10
            .map(v => ({
                votePubkey: v.votePubkey,
                nodePubkey: v.nodePubkey,
                activatedStake: v.activatedStake,
                commission: v.commission,
                epochCredits: v.epochCredits?.length || 0
            }));

        return res.json({
            success: true,
            network: 'devnet',
            totalActive: voteAccounts.current.length,
            totalDelinquent: voteAccounts.delinquent.length,
            activeValidators
        });
    } catch (err) {
        return res.status(500).json({
            error: 'Failed to fetch validators.',
            detail: err.message
        });
    }
});

// Network information
router.get('/network-info', async (req, res) => {
    try {
        const genesisHash = await connection.getGenesisHash();
        const isDevnet = genesisHash === 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
        const slot = await connection.getSlot();
        
        return res.json({
            endpoint: connection.rpcEndpoint,
            genesisHash,
            network: isDevnet ? 'devnet' : 'unknown',
            isDevnet,
            currentSlot: slot
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;