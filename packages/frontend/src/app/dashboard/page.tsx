'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authenticatedFetch } from '../utils/auth';
import { useSocket } from '../context/socketContext'; // Add this import
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';


import {
  Bot,
  TrendingUp,
  Wallet,
  PiggyBank,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  X,
  ExternalLink,
  Plus,
  Minus,
  DollarSign,
  Target,
  Clock,
  Zap,
  ArrowLeft,
  LayoutDashboard,
  AlertCircle,
  Download
} from 'lucide-react';

// Define the AppUser type
interface AppUser {
  id: number;
  walletAddress: string;
  name: string | null;
}

// Update the transaction interface to match the database schema
interface AppTransaction {
  id: number;
  amount: number;
  amountUSD: number | null;
  amountNGN: number | null;
  description: string;
  category: string;
  currency: string;
  type: 'expense' | 'income';
  date: string;
  txHash?: string; // Optional field for on-chain transactions
}

interface Budget {
  amount: number;
  currency: 'NGN' | 'USD';
}

interface Goal {
    id: number;
    name: string;
    targetAmount: number;
    currentAmount: number;
    type: 'SAVINGS' | 'INVESTMENT';
    currency: 'NGN' | 'USD';
}


export default function Dashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [transactions, setTransactions] = useState<AppTransaction[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [totalSpent, setTotalSpent] = useState<number>(0);
  const [loadingData, setLoadingData] = useState(true);
  const { socket } = useSocket(); // Add this line to use the socket context
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isStaking, setIsStaking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  
  
  const router = useRouter();


  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  // Authentication check and data fetching
  useEffect(() => {
    const authenticateAndFetchData = async () => {
      setLoadingData(true);
      const token = localStorage.getItem('lyra_token');

      if (!token) {
        console.log("No token found. Redirecting to home.");
        router.push('/');
        return;
      }

      try {
        const res = await authenticatedFetch('http://localhost:3001/api/auth/validate');
        if (!res.ok) {
          localStorage.removeItem('lyra_token');
          router.push('/');
          return;
        }

        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
          setIsMounted(true);
          // Now fetch transactions and budget for the authenticated user
          await fetchData(data.user.walletAddress);
        } else {
          localStorage.removeItem('lyra_token');
          router.push('/');
        }
      } catch (error) {
        console.error("Authentication or data fetching error:", error);
        localStorage.removeItem('lyra_token');
        router.push('/');
      } finally {
        setLoadingData(false);
      }
    };

    authenticateAndFetchData();
  }, [router]);

  const fetchGoals = async (walletAddress: string) => {
    try {
        const res = await authenticatedFetch(`http://localhost:3001/api/goals/${walletAddress}`);
        const data = await res.json();
        if (data.success) {
            setGoals(data.goals);
        }
    } catch (error) {
        console.error("Failed to fetch goals:", error);
    }
  };

  useEffect(() => {
    if (user?.walletAddress) {
        fetchData(user.walletAddress);
        fetchGoals(user.walletAddress); // Fetch goals when user is available
    }
  }, [user?.walletAddress]);

  // --- BACKEND ACTION HANDLERS ---
  const handleAction = async (action: 'save' | 'stake', goalId?: number) => {
    if (surplus <= 0) {
        alert("You have no surplus to take action on!");
        return;
    }
    if (!publicKey) {
        alert("Please connect your wallet first.");
        return;
    }

    action === 'save' ? setIsSaving(true) : setIsStaking(true);

    try {
        const res = await authenticatedFetch(`http://localhost:3001/api/action/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: surplus,
                currency: budget?.currency,
                goalId: goalId
            }),
        });

        if (!res.ok) {
            const errorData = await res.json();
            if (errorData.error && errorData.error.toLowerCase().includes("liquidity")) {
                throw new Error("Could not find a swap route. Devnet liquidity is likely too low right now. Please try again later.");
            }
            throw new Error(`Failed to prepare ${action} transaction: ${errorData.detail || errorData.error}`);
        }
        
        const { transaction: serializedTransaction } = await res.json();
        const transactionBuffer = Buffer.from(serializedTransaction, 'base64');
        
        let transaction;
        try {
            transaction = Transaction.from(transactionBuffer);
        } catch (e) {
            transaction = VersionedTransaction.deserialize(transactionBuffer);
        }
        
        const txSignature = await sendTransaction(transaction, connection);
        console.log(`${action} successful! Signature:`, txSignature);

         await authenticatedFetch(`http://localhost:3001/api/action/confirm-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                txSig: txSignature,
                action: action,
                goalId: goalId,
                amount: surplus,
                currency: budget?.currency,
            }),
        });
        alert(`Your surplus has been successfully ${action === 'save' ? 'saved' : 'staked'}!`);

         await Promise.all([
            fetchGoals(user!.walletAddress),
            fetchData(user!.walletAddress) // Refresh transactions
        ]);

        await fetchGoals(user!.walletAddress);

    } catch (error) {
        // ✨ FIX: Implement robust error message handling
        console.error(`Error during ${action}:`, error);
        let errorMessage = "An unexpected error occurred. Please try again.";
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }
        setActionError(errorMessage);
        setTimeout(() => setActionError(null), 7000);
    } finally {
        action === 'save' ? setIsSaving(false) : setIsStaking(false);
    }
  };

  const handleDownloadReport = async () => {
    setIsGeneratingReport(true);
    setActionError(null);
    try {
        const res = await authenticatedFetch('http://localhost:3001/api/reports/weekly-summary');
        if (!res.ok) {
            throw new Error("Failed to generate the report on the server.");
        }

        // Convert the response to a blob
        const blob = await res.blob();
        // Create a temporary URL for the blob
        const url = window.URL.createObjectURL(blob);
        // Create a temporary link element to trigger the download
        const a = document.createElement('a');
        a.href = url;
        a.download = `LyraAI_Weekly_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        
        // Clean up by revoking the object URL and removing the link
        window.URL.revokeObjectURL(url);
        a.remove();

    } catch (error: any) {
        console.error("Failed to download report:", error);
        setActionError(error.message);
        setTimeout(() => setActionError(null), 7000);
    } finally {
        setIsGeneratingReport(false);
    }
  };

  // WebSocket setup - Add this useEffect for socket logic
  useEffect(() => {
    if (user?.walletAddress && socket) {
      // Register the wallet with the WebSocket server
      socket.emit('register_wallet', user.walletAddress);
      console.log('Dashboard: Registered wallet with WebSocket:', user.walletAddress);

      // Listen for new transactions
      const handleNewTransaction = (newTx: any) => {
        console.log("Dashboard: New transaction received:", newTx);
        
        // Create a new transaction object that matches our Transaction interface
        const newTransaction: AppTransaction = {
          id: Date.now(), // Use timestamp as ID for now
          amount: parseFloat(newTx.amount) || 0,
          amountUSD: newTx.amountUSD || null,
          amountNGN: newTx.amountNGN || null,
          description: newTx.description || `${newTx.type} - ${newTx.category}`,
          category: newTx.category || 'Other',
          currency: newTx.currency || 'USD',
          type: newTx.type as 'expense' | 'income',
          date: new Date().toISOString(),
          txHash: newTx.txHash || undefined,
        };

        // Add the new transaction to the beginning of the list
        setTransactions(prevTransactions => [newTransaction, ...prevTransactions]);
      };

      // Set up the event listener
      socket.on('new_tx', handleNewTransaction);

      // Cleanup function
      return () => {
        socket.off('new_tx', handleNewTransaction);
        console.log('Dashboard: Cleaned up WebSocket listeners');
      };
    }
  }, [user?.walletAddress, socket]);

  // Fetches transaction and budget data from the backend
  const fetchData = async (walletAddress: string) => {
    try {
      // Fetch all expenses
      const expenseRes = await authenticatedFetch(`http://localhost:3001/api/expenses/${walletAddress}`);
      const expenseData = await expenseRes.json();
      console.log("Fetched expense data:", expenseData); // Debugging log
      if (expenseData.success) {
        setTransactions(expenseData.expenses);
      } else {
        console.log("No expenses found or API call failed.");
        setTransactions([]); // Set to empty array to avoid rendering issues
      }

      // Fetch the user's budget
      const budgetRes = await authenticatedFetch(`http://localhost:3001/api/budget/${walletAddress}`);
      const budgetData = await budgetRes.json();
      console.log("Fetched budget data:", budgetData); // Debugging log
      if (budgetData.success && budgetData.budget) {
        setBudget(budgetData.budget);
      } else {
        console.log("No budget found. Setting default.");
        setBudget({ amount: 0, currency: 'USD' }); // Fallback to a default budget
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      setTransactions([]);
      setBudget({ amount: 0, currency: 'USD' });
    }
  };

  // Aggregate spent amount based on budget currency
  const calculateTotalSpent = useCallback(() => {
    if (!transactions.length || !budget) {
      setTotalSpent(0);
      return;
    }

    let total = 0;
    transactions.forEach(tx => {
      if (tx.type === 'expense') {
        const amount = parseFloat(tx.amount.toFixed(2));
        const amountUSD = tx.amountUSD !== null ? parseFloat(tx.amountUSD.toFixed(2)) : null;
        const amountNGN = tx.amountNGN !== null ? parseFloat(tx.amountNGN.toFixed(2)) : null;

        if (tx.currency === budget.currency) {
          total += amount;
        } else if (budget.currency === 'USD' && amountUSD !== null) {
          total += amountUSD;
        } else if (budget.currency === 'NGN' && amountNGN !== null) {
          total += amountNGN;
        }
      }
    });
    setTotalSpent(total);
  }, [transactions, budget]);

  useEffect(() => {
    calculateTotalSpent();
  }, [calculateTotalSpent]);

  // Handler functions (can be expanded to call backend APIs)
  const handleConfirmTransaction = (id: number) => {
    // This is currently a frontend-only state change.
    // In a real app, you would send this to the backend.
    setTransactions(prev =>
      prev.map(tx => tx.id === id ? { ...tx, confirmed: true } : tx)
    );
  };

  const handleRejectTransaction = (id: number) => {
    // This is currently a frontend-only state change.
    setTransactions(prev =>
      prev.filter(tx => tx.id !== id)
    );
  };

  const currentBudget = budget?.amount || 0;
  const remaining = currentBudget - totalSpent;
  const budgetProgress = (totalSpent / currentBudget) * 100;
  const surplus = remaining > 0 ? remaining : 0;
  const currencySymbol = budget?.currency === 'NGN' ? '₦' : '$';

  // Show a loading screen until the user is authenticated and data is fetched
  if (loadingData || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black text-white font-mono">
      {/* Header */}
      <div className="border-b border-purple-700/20 bg-black/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href='/chat' passHref>
              <div className="relative cursor-pointer group p-2 rounded-full border border-gray-700/50 hover:bg-gray-800/50 transition-colors duration-200">
                <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white rounded py-1 px-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  Back to Chat
                </span>
              </div>
              </Link>
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/25">
                  <LayoutDashboard className="w-5 h-5 text-black" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-300 rounded-full border-2 border-black animate-pulse shadow-sm shadow-green-300/50"></div>
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent tracking-wide">
                  LyraAI Dashboard
                </h1>
                <p className="text-sm text-gray-500 font-light">Financial Intelligence at a Glance</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* WebSocket Connection Status */}
              <div className="text-sm text-gray-400 font-mono flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${socket ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
                <span>{socket ? 'Live Sync Active' : 'Disconnected'}</span>
              </div>
              <Clock className="w-4 h-4 text-gray-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Budget Overview */}
        <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-3xl p-8 shadow-2xl shadow-black/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-gradient-to-r from-purple-600 to-cyan-400 rounded-full flex items-center justify-center">
              <Target className="w-4 h-4 text-black" />
            </div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent">
              Weekly Budget Overview
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-400 font-light">Weekly Budget</p>
              <p className="text-3xl font-bold text-white">{currencySymbol}{currentBudget.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-400 font-light">Spent So Far</p>
              <p className="text-3xl font-bold text-red-400">{currencySymbol}{totalSpent.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm text-gray-400 font-light">Remaining</p>
              <p className="text-3xl font-bold text-green-400">{currencySymbol}{remaining.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-8">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">Progress</span>
              <span className="text-sm text-gray-400">{budgetProgress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${Math.min(budgetProgress, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Two Column Grid for Transactions and Surplus */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* LEFT COLUMN: Expense Feed */}
          <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-3xl p-6 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-black" />
                </div>
                <h2 className="text-xl font-bold text-white">Live Transactions</h2>
              </div>
               {/* ✨ 3. Add the download button */}
              <button
                onClick={handleDownloadReport}
                disabled={isGeneratingReport}
                className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 disabled:opacity-50 disabled:cursor-wait"
              >
                {isGeneratingReport ? (
                    <>
                        <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Generating...</span>
                    </>
                ) : (
                    <>
                        <Download className="w-4 h-4" />
                        <span>Download Report</span>
                    </>
                )}
              </button>
              <div className="flex items-center gap-1 text-xs text-green-400">
                <div className={`w-2 h-2 rounded-full ${socket ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
                {socket ? 'Synced' : 'Offline'}
              </div>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className={`border border-gray-700/50 rounded-2xl p-4 transition-all duration-300 bg-gray-800/50 hover:bg-gray-800/70`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.type === 'expense' ? 'bg-gradient-to-r from-red-500 to-orange-400' : 'bg-gradient-to-r from-green-500 to-teal-400'}`}>
                        {tx.type === 'expense' ? (
                          <ArrowUpRight className="w-4 h-4 text-white" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 text-white" />
                        )}
                      </div>
                      <div>
                        <h3 className="font-medium text-white">{tx.description}</h3>
                        <p className="text-xs text-gray-400">{new Date(tx.date).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                     <div className="text-right">
  <p className="font-bold text-white">
    {currencySymbol}
    {(
      budget?.currency === 'USD' 
        ? tx.amountUSD 
        : tx.amountNGN
    )?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
  </p>
  {/* This part adds a helpful sub-label if the original tx was in a different currency */}
  {tx.currency !== budget?.currency && (
    <p className="text-xs text-gray-400">
      ({tx.amount.toLocaleString()} {tx.currency})
    </p>
  )}
</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-gray-700/50 rounded-lg text-xs text-gray-300">
                        {tx.category}
                      </span>
                      {tx.txHash && (
                        <button
                          onClick={() => window.open(`https://solscan.io/tx/${tx.txHash}?cluster=devnet`, '_blank')}
                          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View TX
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {transactions.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No transactions yet. Start spending to see live updates!</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Surplus & Goals */}
          <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-3xl p-6 shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 bg-gradient-to-r from-cyan-600 to-blue-400 rounded-full flex items-center justify-center">
                <PiggyBank className="w-4 h-4 text-black" />
              </div>
              <h2 className="text-xl font-bold text-white">Surplus & Goals</h2>
            </div>

            <div className="text-center mb-8">
              <p className="text-sm text-gray-400 font-light mb-2">This Week's Surplus</p>
              <p className="text-4xl font-bold bg-gradient-to-r from-green-300 to-cyan-300 bg-clip-text text-transparent">
                {currencySymbol}{surplus.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            <div className="space-y-4">
              {goals.length > 0 ? (
                goals.map(goal => (
                  <div key={goal.id} className="w-full group bg-gradient-to-r from-green-600/10 to-cyan-600/10 border border-green-500/20 rounded-2xl p-4 transition-all duration-300">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-left">
                          <h3 className="font-medium text-white">{goal.name} ({goal.type})</h3>
                          <p className="text-sm text-gray-400">
                            {currencySymbol}{goal.currentAmount.toLocaleString()} / {currencySymbol}{goal.targetAmount.toLocaleString()}
                          </p>
                        </div>
                        <button 
                            onClick={() => handleAction(goal.type === 'SAVINGS' ? 'save' : 'stake', goal.id)}
                            disabled={isSaving || isStaking || surplus <= 0}
                            className="px-4 py-2 text-sm bg-green-500 text-black rounded-lg font-bold hover:bg-green-400 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                        >
                           {isSaving ? 'Saving...' : 'Save Surplus'}
                        </button>
                    </div>
                    {/* Progress Bar for Goal */}
                    <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-green-500 to-cyan-400 rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${Math.min((goal.currentAmount / goal.targetAmount) * 100, 100)}%` }}
                        />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500">No goals set up yet. Go to the chat to create one!</p>
              )}
              
              {/* General Staking Button */}
              <button 
                onClick={() => handleAction('stake')}
                disabled={isStaking || surplus <= 0}
                className="w-full mt-4 group bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 rounded-2xl p-4 hover:from-purple-600/30 hover:to-pink-600/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center justify-between">
                    <div className="text-left">
                      <h3 className="font-medium text-white">Stake Surplus for Yield</h3>
                      <p className="text-sm text-gray-400">Contribute to network security and earn rewards.</p>
                    </div>
                    <ArrowUpRight className="w-5 h-5 text-purple-400 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </div>
              </button>

              {actionError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    <p>{actionError}</p>
                </div>
              )}

              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}