'use client';

import AutoSignerModal from './components/autoSignerModal';
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Bot, ArrowRight } from 'lucide-react';
import WalletConnection from './components/connectWallet';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const [showSignerModal, setShowSignerModal] = useState(false);
  
  const wallet = useWallet();
  const { publicKey, connected } = wallet;
  const router = useRouter();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (connected && publicKey) {
      setShowSignerModal(true);
    }
  }, [connected, publicKey]);

  const handleWalletConnected = (walletAddress: string) => {
    console.log('Wallet connected:', walletAddress);
  };

  const handleSignerChoice = async (choice: "manual" | "auto") => {
    setShowSignerModal(false);

    if (!publicKey) {
      console.error("Public key is null. Cannot proceed.");
      return;
    }
    
    const walletAddress = publicKey.toBase58();

    console.log("Wallet Address:", walletAddress); 

    if (choice === "auto") {
      // Declare nonce outside the try block
      let nonce = null;
      try {
        console.log("Starting auto-sign challenge...");
        
        // 1. Get the nonce from the backend
        const challengeResp = await fetch("http://localhost:3001/api/auth/challenge", {
          method: "POST",
          body: JSON.stringify({ wallet: walletAddress }),
          headers: { "Content-Type": "application/json" },
        });
        if (!challengeResp.ok) throw new Error('Failed to get challenge');
        
        const data = await challengeResp.json();
        nonce = data.nonce;

        // 2. Safely sign the message
        if (!wallet.signMessage) {
          throw new Error('Wallet does not support the signMessage function.');
        }
        
        const encodedMessage = new TextEncoder().encode(nonce);
        const signature = await wallet.signMessage(encodedMessage);
        console.log(signature)

        // 3. Send signature back to the backend
        // Convert the Uint8Array to a Base64 string for reliable transmission
        const base64Signature = btoa(String.fromCharCode(...signature));
        console.log(base64Signature)

        const verifyResp = await fetch("http://localhost:3001/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({
            wallet: walletAddress,
            signature: base64Signature, // Send as a Base64 string
          }),
          headers: { "Content-Type": "application/json" },
        });
        
        if (!verifyResp.ok) throw new Error('Failed to verify signature');
        const { token } = await verifyResp.json();

        // 4. Store token and navigate
        localStorage.setItem("lyra_token", token);
        console.log("✅ Auto-sign enabled, token saved. Navigating to chat...");
        router.push('/chat');

      } catch (error) {
        console.error("Auto-sign process failed:", error);
      }
    } else {
      console.log("Manual signing mode selected.");

      // This is the definitive URL string that is about to be pushed
      const targetUrl = `/chat?wallet=${walletAddress}&mode=manual`;
      console.log("Navigating to URL:", targetUrl);

      router.push(targetUrl);
    }
  };

  // The rest of your JSX remains the same
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black text-white font-mono">
      {/* Navigation */}
      <nav className="border-b border-purple-700/20 bg-black/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <Bot className="w-5 h-5 text-black" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-300 rounded-full border-2 border-black animate-pulse shadow-sm shadow-green-300/50"></div>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent tracking-wide">
                  Sol-AI
                </h1>
                <p className="text-xs text-gray-500 font-light">Your AI Financial Assistant</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
            {connected && publicKey ? (
              <div className="text-sm text-green-400 font-light">
                Connected: {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
              </div>
            ) : null}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center space-y-8">
            <div className="space-y-4">
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-purple-300 via-cyan-300 to-green-300 bg-clip-text text-transparent">
                  Meet LyraAI
                </span>
              </h1>
              <p className="text-xl md:text-2xl text-gray-300 font-light max-w-3xl mx-auto leading-relaxed">
                LyraAI is your Web3-native financial AI agent: it tracks wallet expenses in real-time, helps you budget with AI, and automatically saves or invests your surplus safely on-chain
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-8">
              <WalletConnection onWalletConnected={handleWalletConnected} />
              
              {connected && (
                <div className="group">
                  <button className="px-8 py-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl hover:bg-gray-800/90 transition-all duration-300 flex items-center gap-3 shadow-xl shadow-black/50 hover:scale-105">
                    <span className="font-light tracking-wide">Start Chatting</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              )}
            </div>

            {!connected && (
            <p className="text-sm text-gray-500 font-light">
              Connect your wallet to unlock LyraAI
            </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-700/30 bg-black/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center">
                <Bot className="w-4 h-4 text-black" />
              </div>
              <span className="text-sm text-gray-400 font-light">
                Sol-AI is powered by advanced AI. Always verify financial advice and do your own research.
              </span>
            </div>
            
            <div className="text-xs text-gray-600 font-mono opacity-60">
              Built on Solana • Secured by blockchain
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      <div>
        <AutoSignerModal
          isOpen={showSignerModal}
          onChoice={handleSignerChoice}
          walletAddress={publicKey ? publicKey.toBase58() : ''}
        />
      </div>
    </div>
  );
}