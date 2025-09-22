// backend/walletListener.js
import { Connection, PublicKey, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";
import fetch from 'node-fetch'

// Import your AI categorizer function
import { categorizeTx } from "./aiCategorizer.js";

const prisma = new PrismaClient();
// Ensure you are using a reliable RPC URL, consider putting it in your .env file
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"), "confirmed");

// Map to store active listener classes for each wallet
const activeListeners = new Map();

// ✨ Set to track recently processed transaction signatures to prevent duplicates
const processedSignatures = new Set();

// Map token mint → currency code for common tokens
const TOKEN_MAP = {
  "So11111111111111111111111111111111111111112": "SOL",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "Es9vMFrzaCERsBY1HgM7zE3ip1J6fU6CB9hLh9jU4gQ": "USDT",
};


async function getSoltoUsdRate() {
  try {
    const res = await fetch(`https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`);
    const data = await res.json();
    
    if (data.length > 0 && data[0].price) {
      const pythPrice = data[0].price;
      const price = parseFloat(pythPrice.price);
      const exponent = parseInt(pythPrice.expo);
      const actualPrice = price * Math.pow(10, exponent);
      console.log('Debugging SOL/USD', actualPrice);
      return actualPrice;
    } else {
      console.error("Pyth API response is malformed or missing price data.");
      return null;
    }
  } catch (err) {
    console.error('Error fetching data sol/usd', err);
    return null;
  }
}

async function getUsdtoNairaRate() {
  try {
    const res = await fetch('https://v6.exchangerate-api.com/v6/a0396d8ac9736da182bd7ca5/latest/USD');
    const data = await res.json();
    
    if (data.conversion_rates && data.conversion_rates.NGN) {
      console.log('Debugging USD/NGN', data.conversion_rates.NGN);
      return data.conversion_rates.NGN;
    } else {
      console.error("ExchangeRate-API response is malformed or missing NGN rate.");
      return null;
    }
  } catch (err) {
    console.error('Error fetching currency data', err);
    return null;
  }
}

export async function updateUserWalletBalance(walletAddress) {
  console.log(`🔎 Fetching balance for: ${walletAddress}`);
  try {
    const publicKey = new PublicKey(walletAddress);
    const balanceInLamports = await connection.getBalance(publicKey);
    const balanceInSol = balanceInLamports / LAMPORTS_PER_SOL;
    console.log(`💰 Balance found: ${balanceInSol} SOL`);

    await prisma.user.update({
      where: {
        walletAddress: walletAddress,
      },
      data: {
        balance: balanceInSol,
      },
    });
  } catch (error) {
    console.error(`❌ Error fetching balance for ${walletAddress}:`, error);
  }
}

/**
 * A class to manage the lifecycle of a single Solana wallet listener.
 */
class WalletListener {
  constructor(walletAddress, io) {
    this.walletAddress = walletAddress;
    this.io = io;
    this.subscriptionId = null;
    this.publicKey = new PublicKey(walletAddress);
  }

  async start() {
    console.log("👂 Listening for wallet txs:", this.walletAddress);
    await updateUserWalletBalance(this.walletAddress);

    this.subscriptionId = connection.onLogs(this.publicKey, async (log) => {
      try {
        const txSig = log.signature;

        // ✨ --- DE-DUPLICATION CHECK --- ✨
        // If we've seen this signature in the last 30 seconds, ignore it.
        if (processedSignatures.has(txSig)) {
          return;
        }
        processedSignatures.add(txSig);
        // Remove the signature from the set after 30 seconds to prevent memory leaks
        setTimeout(() => processedSignatures.delete(txSig), 30000);

        const tx = await connection.getParsedTransaction(txSig, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) return;
        const { meta } = tx;

        // ... (The rest of your SOL and SPL token processing logic remains exactly the same) ...
        // 1. Handle SOL balance delta
        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          (acc) => acc.pubkey.toBase58() === this.walletAddress
        );

        if (accountIndex !== -1) {
          const preSol = meta.preBalances[accountIndex] / 1e9;
          const postSol = meta.postBalances[accountIndex] / 1e9;
          const delta = postSol - preSol;

          if (delta !== 0) {
            const type = delta < 0 ? "expense" : "income";
            const amount = Math.abs(delta);

            console.log(
              `${type === "expense" ? "🔻" : "💰"} SOL ${type}: ${amount}`
            );

            const category =
              type === "expense"
                ? await categorizeTx({
                    token: "SOL",
                    amount,
                    type,
                    memo: tx.transaction.message?.instructions[0]?.parsed?.info
                      ?.memo,
                    to: tx.transaction.message?.accountKeys[1]?.pubkey?.toBase58(),
                  })
                : "Income";

            const solToUsdRate = await getSoltoUsdRate();
            const usdToNgnRate = await getUsdtoNairaRate();
            const amountUSD = solToUsdRate ? amount * solToUsdRate : null;
            const amountNGN = (amountUSD && usdToNgnRate) ? amountUSD * usdToNgnRate : null;

            const record = await prisma.expense.create({
              data: {
                txSig: txSig,
                amount,
                amountUSD,
                amountNGN,
                description: `On-chain SOL ${type}`,
                category,
                currency: "SOL",
                type,
                user: {
                  connectOrCreate: {
                    where: { walletAddress: this.walletAddress },
                    create: { walletAddress: this.walletAddress },
                  },
                },
              },
            });

            this.io.to(this.walletAddress).emit("new_tx", record);
          }
        }

        // 2. Handle SPL token balance delta
        const preTokenBalances = meta.preTokenBalances || [];
        const postTokenBalances = meta.postTokenBalances || [];

        for (let i = 0; i < postTokenBalances.length; i++) {
          // ... (rest of SPL token logic is unchanged)
        }

      } catch (err) {
        console.error("Listener error:", err);
      }
    });
  }

  async stop() {
    if (this.subscriptionId !== null) {
      await connection.removeListener(this.subscriptionId);
      console.log("🛑 Stopped listening for:", this.walletAddress);
    }
  }
}

export { WalletListener, activeListeners, getSoltoUsdRate, getUsdtoNairaRate };