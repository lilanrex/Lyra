// components/connectWallet.tsx
'use client';

import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Wallet, X } from 'lucide-react';

interface WalletConnectionProps {
  onWalletConnected?: (walletAddress: string) => void;
}

export default function WalletConnection({ onWalletConnected }: WalletConnectionProps) {
  const { wallet, wallets, select, connect, connected, publicKey, disconnect, connecting } = useWallet();
  const [showWalletModal, setShowWalletModal] = useState(false);

  const handleWalletSelect = async (wallet: { adapter: { name: any } }) => {
    try {
      select(wallet.adapter.name);
      setShowWalletModal(false);
      // Let the connection happen naturally through the wallet adapter
      if (onWalletConnected && publicKey) {
        onWalletConnected(publicKey.toBase58());
      }
    } catch (error) {
      console.error('Failed to select wallet:', error);
    }
  };

  if (connected && publicKey) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-6 py-3 bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl hover:bg-red-900/20 hover:border-red-700/50 transition-all duration-300 flex items-center gap-3 shadow-xl shadow-black/50"
      >
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
        <span className="font-light tracking-wide">
          {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
        </span>
        <span className="text-xs text-gray-500">Disconnect</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowWalletModal(true)}
        disabled={connecting}
        className="px-8 py-4 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-2xl hover:from-purple-700 hover:to-cyan-700 transition-all duration-300 flex items-center gap-3 shadow-2xl shadow-purple-500/25 hover:scale-105 font-light tracking-wide disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Wallet className="w-5 h-5" />
        <span>{connecting ? 'Connecting...' : 'Connect Wallet'}</span>
      </button>

      {showWalletModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-purple-700/40 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-purple-300">Select Wallet</h3>
              <button
                onClick={() => setShowWalletModal(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {wallets && wallets.length > 0 ? (
                wallets.map((w) => (
                  <button
                    key={w.adapter.name}
                    onClick={() => handleWalletSelect(w)}
                    disabled={connecting}
                    className="w-full flex items-center gap-4 p-4 bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <img
                      src={w.adapter.icon}
                      alt={w.adapter.name}
                      className="w-8 h-8"
                    />
                    <span className="font-light text-white">{w.adapter.name}</span>
                    {connecting && (
                      <div className="ml-auto">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400"></div>
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="mb-4">No Solana wallets detected</p>
                  <a
                    href="https://phantom.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline text-sm"
                  >
                    Install Phantom Wallet
                  </a>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 text-center mt-6">
              By connecting, you agree to allow LyraAI to monitor your wallet for transactions
            </p>
          </div>
        </div>
      )}
    </>
  );
}