// txRoutes.ts
import express from "express";
import jwt from "jsonwebtoken";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createTransferInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import dotenv from "dotenv";

dotenv.config();

// remember to implement usdc stake/save.

const router = express.Router();

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Backend fee payer
const FEE_PAYER = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.FEE_PAYER_KEYPAIR))
);
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

// 🔒 Middleware to validate JWT
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET) 
    req.user = decoded; // contains wallet
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// --------------------
// Save endpoint
// --------------------
router.post("/save", authenticate, async (req, res) => {
  try {
    const { amountLamports } = req.body; // e.g. 1000000 lamports
    const userWallet = new PublicKey(req.user.wallet);

    // Derive PDA for vault
    const [vaultPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), userWallet.toBuffer()],
      PROGRAM_ID
    );

    // Build tx
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: FEE_PAYER.publicKey,
        toPubkey: vaultPda,
        lamports: amountLamports,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [FEE_PAYER]);
    return res.json({ signature: sig });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Save failed" });
  }
});

// --------------------
// Stake endpoint
// --------------------
router.post("/stake", authenticate, async (req, res) => {
  try {
    const { amountLamports } = req.body;
    const userWallet = new PublicKey(req.user.wallet);

    // Derive stake PDA (could be same as vault or separate)
    const [stakePda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("stake"), userWallet.toBuffer()],
      PROGRAM_ID
    );

    // For now, just transfer into stake PDA
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: FEE_PAYER.publicKey,
        toPubkey: stakePda,
        lamports: amountLamports,
      })
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [FEE_PAYER]);
    return res.json({ signature: sig });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Stake failed" });
  }
});

export default router;
