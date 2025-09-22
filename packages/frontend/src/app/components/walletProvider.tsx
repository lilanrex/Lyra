// walletProvider.tsx - Fixed version with CSS import
'use client'

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { useMemo, useCallback, ReactNode, useEffect, useState } from "react"
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'

// Import the required CSS - THIS IS CRUCIAL
import '@solana/wallet-adapter-react-ui/styles.css'

interface SolanaWalletProviderProps {
    children: ReactNode
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
    const [mounted, setMounted] = useState(false);

    // Prevent hydration issues
    useEffect(() => {
        setMounted(true);
    }, []);

    const endpoint = useMemo(() => {
        return process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com'
    }, [])

    const wallets = useMemo(
        () => [
           
            new SolflareWalletAdapter(),
            new PhantomWalletAdapter(),
        ],
        []
    )

    const onError = useCallback((error: any, adapter?: any) => {
        console.error('Wallet Provider Error:', error)
        
        // Handle specific wallet errors
        switch (error.name) {
            case 'WalletNotReadyError':
                console.error(`${adapter?.name || 'Wallet'} is not ready. Please ensure it's installed and enabled.`)
                // Don't show error for auto-connect attempts
                if (!error.message?.includes('autoConnect')) {
                    console.warn('Please install the wallet extension and refresh the page.')
                }
                break
            case 'WalletConnectionError':
                console.error('Failed to connect to wallet:', error.message)
                // Suppress auto-connect errors
                if (!error.message?.includes('autoConnect')) {
                    console.warn('Connection failed. Please try connecting manually.')
                }
                break
            case 'WalletNotInstalledError':
                console.error(`${adapter?.name || 'Wallet'} is not installed.`)
                break
            default:
                console.error('Unknown wallet error:', error.message || error)
        }
        
        // Don't throw errors for auto-connect failures
        return false;
    }, [])

    // Don't render until mounted to prevent hydration issues
    if (!mounted) {
        return <div>{children}</div>;
    }

    return (
        <ConnectionProvider 
            endpoint={endpoint}
            config={{
                commitment: 'processed',
                confirmTransactionInitialTimeout: 60000, // 60 seconds
            }}
        >
            <WalletProvider 
                wallets={wallets} 
                onError={onError}
                autoConnect={true} 
                localStorageKey="solana-wallet"
            >
                <WalletModalProvider>
                    {children}
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    )
}