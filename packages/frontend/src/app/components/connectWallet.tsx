// connectWallet.tsx - Fixed with better styling
'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton, WalletDisconnectButton } from '@solana/wallet-adapter-react-ui';
import { useState, useEffect } from 'react';

interface WalletConnectionProps {
  onWalletConnected?: (walletAddress: string) => void;
}

export default function WalletConnection({ onWalletConnected }: WalletConnectionProps) {
  const { connected, publicKey } = useWallet();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (connected && publicKey && onWalletConnected) {
      onWalletConnected(publicKey.toBase58());
    }
  }, [connected, publicKey, onWalletConnected]);

  if (!mounted) {
    return (
      <div className="px-8 py-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl animate-pulse">
        <div className="h-4 w-24 bg-gray-700 rounded"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="wallet-adapter-button-container">
        <WalletMultiButton 
          style={{
            background: 'linear-gradient(to right, rgb(147, 51, 234), rgb(59, 130, 246))',
            borderRadius: '16px',
            padding: '16px 32px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            boxShadow: '0 25px 50px -12px rgba(147, 51, 234, 0.25)',
            transition: 'all 0.3s ease',
          }}
        />
        
        {connected && (
          <div className="mt-4">
            <WalletDisconnectButton 
              style={{
                background: 'rgba(75, 85, 99, 0.9)',
                borderRadius: '16px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '500',
                border: '1px solid rgba(75, 85, 99, 0.5)',
                color: 'white',
              }}
            />
          </div>
        )}
      </div>
      
      {connected && publicKey && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-green-400 font-mono">
              {publicKey.toBase58().slice(0, 6)}...{publicKey.toBase58().slice(-4)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}