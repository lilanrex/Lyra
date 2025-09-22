import express from "express";
import jwt from "jsonwebtoken";

import crypto from "crypto"
import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient()
dotenv.config();




import nacl from 'tweetnacl';




const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';


// In-memory storage for nonces (in production, use Redis or database)
const nonces = new Map();

// JWT secret (in production, use environment variable)


// /api/auth/challenge route
router.post('/challenge', async (req, res) => {
  const { wallet } = req.body;

  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'Wallet address is required' });
  }

  try {
    // Validate wallet address format
    new PublicKey(wallet);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  try {
    // Generate a random nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    
    // Store nonce with expiration (5 minutes)
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    nonces.set(wallet, { nonce, expiresAt });

    // Clean up expired nonces periodically
    for (const [key, value] of nonces.entries()) {
      if (value.expiresAt < Date.now()) {
        nonces.delete(key);
      }
    }

    return res.status(200).json({ 
      success: true, 
      nonce,
      message: 'Sign this message to authenticate with Sol-AI'
    });
  } catch (error) {
    console.error('Error generating challenge:', error);
    return res.status(500).json({ error: 'Failed to generate authentication challenge' });
  }
});

// /api/auth/verify route
router.post('/verify', async (req, res) => {
  const { wallet, signature } = req.body;

  if (!wallet || !signature) {
    return res.status(400).json({ error: 'Wallet address and signature are required' });
  }

  // New check for Base64 string format
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Signature must be a base64 string' });
  }

  try {
    const storedData = nonces.get(wallet);
    if (!storedData || Date.now() > storedData.expiresAt) {
      nonces.delete(wallet);
      return res.status(400).json({ error: 'Challenge expired or not found, please request a new one' });
    }

    const { nonce } = storedData;
    const publicKey = new PublicKey(wallet);
    const messageBytes = new TextEncoder().encode(nonce);

    // Decode the Base64 string back to a Uint8Array
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes, // This must be a correctly formatted Uint8Array
      publicKey.toBytes()
    );
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Clean up used nonce
    nonces.delete(wallet);

    // Create or update user in database
    let user;
    try {
      user = await prisma.user.upsert({
        where: { walletAddress: wallet },
        update: { updatedAt: new Date() },
        create: { 
          walletAddress: wallet,
          name: null // Will be set later when user provides name
        }
      });
    } catch (dbError) {
      console.error('Database error during user upsert:', dbError);
      return res.status(500).json({ error: 'Failed to create/update user record' });
    }

    // Generate JWT token
    const tokenPayload = {
      walletAddress: wallet,
      userId: user.id,
      autoSign: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET);

    return res.status(200).json({ 
      success: true, 
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        name: user.name
      },
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('Error verifying signature:', error);
    return res.status(500).json({ error: 'Failed to verify signature' });
  }
});

// Middleware to verify JWT token
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('JWT Verification Error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// /api/auth/validate route - to check if token is still valid
router.get('/validate', authenticateToken, async (req, res) => {
  try {
    const { walletAddress, userId } = req.user;
    
    // Optionally verify user still exists in database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ 
      success: true, 
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        name: user.name
      },
      autoSign: req.user.autoSign || false
    });
  } catch (error) {
    console.error('Error validating token:', error);
    return res.status(500).json({ error: 'Failed to validate token' });
  }
});

// /api/auth/logout route
router.post('/logout', authenticateToken, (req, res) => {
  // Since we're using stateless JWT, logout is handled client-side
  // by removing the token from localStorage
  return res.status(200).json({ 
    success: true, 
    message: 'Logout successful. Please remove token from client storage.' 
  });
});


export default router