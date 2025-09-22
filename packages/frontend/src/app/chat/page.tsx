'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Bot, User, Zap, LayoutDashboard } from 'lucide-react';
import { authenticatedFetch } from '../utils/auth'; // Reusing this from your other code
import io from 'socket.io-client';
import Link from 'next/link'; // Import Link component
import { useSocket } from '../context/socketContext'; 

// Define the AppUser type
interface AppUser {
    id: number;
    walletAddress: string;
    name: string | null;
}

// ... (Your existing types and NameInputModal component) ...

// Simple NameInputModal definition (replace with your actual implementation if needed)
interface NameInputModalProps {
    onSubmit: (name: string) => void;
    walletAddress: string;
}

const NameInputModal: React.FC<NameInputModalProps> = ({ onSubmit, walletAddress }) => {
    const [name, setName] = useState('');
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
            <div className="bg-gray-900 rounded-xl p-8 shadow-2xl max-w-sm w-full">
                <h2 className="text-lg font-bold mb-4 text-white">Welcome!</h2>
                <p className="text-gray-400 mb-4 text-sm">
                    Please enter your name to personalize your experience.
                </p>
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 py-2 rounded bg-gray-800 text-white mb-4 border border-gray-700 focus:outline-none"
                />
                <button
                    onClick={() => name.trim() && onSubmit(name.trim())}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded font-bold transition"
                >
                    Continue
                </button>
                <p className="text-xs text-gray-500 mt-4 text-center font-mono opacity-60">
                    Wallet: {walletAddress}
                </p>
            </div>
        </div>
    );
};

const getInitialMessages = () => {
  if (typeof window !== 'undefined') {
    const savedMessages = localStorage.getItem('chat_history');
    if (savedMessages) {
      try {
        return JSON.parse(savedMessages);
      } catch (e) {
        console.error("Failed to parse chat history from localStorage", e);
      }
    }
  }
  // Fallback to the default welcome message if no history is found or parsing fails
  return [
    { id: 1, type: 'ai', content: "Hey there! I'm LyraAI, your personal financial AI Agent.", timestamp: new Date().toLocaleTimeString() }
  ];
};

export default function ChatPage() {
  const [messages, setMessages] = useState(getInitialMessages);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [user, setUser] = useState<AppUser | null>(null);
    const [showNameModal, setShowNameModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true); // New loading state
    const { socket } = useSocket();

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();

    // Add handleKeyPress function
    const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (inputValue.trim() && !isTyping) {
                handleSendMessage();
            }
        }
    };

    useEffect(() => {
  // Only run this effect in the browser
  if (typeof window !== 'undefined') {
    localStorage.setItem('chat_history', JSON.stringify(messages));
  }
}, [messages]);

    // The single source of truth for user data and authentication state
   useEffect(() => {
    const initializeUser = async () => {
        const token = localStorage.getItem('lyra_token');
        const walletAddressFromUrl = searchParams.get('wallet');
        const modeFromUrl = searchParams.get('mode');
        let userWalletAddress = null;

        // Scenario 1: User has a token (auto-sign flow completed)
        if (token) {
            try {
                const res = await authenticatedFetch('http://localhost:3001/api/auth/validate');
                if (!res.ok) throw new Error('Token validation failed');
                
                const data = await res.json();
                if (data.success) {
                    const userData = data.user as AppUser;
                    setUser(userData);
                    userWalletAddress = userData.walletAddress;
                    if (!userData.name) {
                        setShowNameModal(true);
                    }
                }
            } catch (error) {
                console.error("Token validation error:", error);
                localStorage.removeItem('lyra_token');
                router.push('/');
            }
        } 
        // Scenario 2: User is in the manual-sign flow
        else if (walletAddressFromUrl && modeFromUrl === 'manual') {
            const tempUser: AppUser = { id: 0, walletAddress: walletAddressFromUrl, name: null };
            setUser(tempUser);
            setShowNameModal(true);
            userWalletAddress = walletAddressFromUrl;
        }
        // Scenario 3: No token and no URL params
        else {
            console.log("No authentication method found. Redirecting to home.");
            router.push('/');
        }

        setIsLoading(false);

        if (userWalletAddress && socket) {
                socket.emit('register_wallet', userWalletAddress);

                socket.on('new_tx', (newTx) => {
                    console.log("New transaction received:", newTx);
                    const txMessage = {
                        id: window.crypto.randomUUID(),
                        type: 'ai' as const,
                        content: `🔔 Transaction Alert: ${newTx.amount} ${newTx.currency} - ${newTx.type} (${newTx.category})`,
                        timestamp: new Date().toLocaleTimeString(),
                    };
                    setMessages((prevMessages: any) => [...prevMessages, txMessage]);
                });

                

                return () => {
                    socket.disconnect();
                    console.log('WebSocket client disconnected on cleanup.');
                };
            }

      
    };
    
    initializeUser();
}, [router, searchParams]);


  ;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Function to handle name submission from the modal
    const handleNameSubmit = async (name: string) => {
        if (!user?.walletAddress) return;
        
        try {
            // Update the user's name on the backend
            const res = await fetch('http://localhost:3001/api/user/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: user.walletAddress, name })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                // Update the local state with the new user data
                const updatedUser: AppUser = { ...user, name: data.user.name };
                setUser(updatedUser);
                setShowNameModal(false);
                setMessages((prev: typeof messages) => [...prev, {
                    id: prev.length + 2, type: 'ai', content: `Awesome, ${name}! I've got you set up. How can I help you today?`, timestamp: new Date().toLocaleTimeString()
                }]);
            } else {
                throw new Error(data.error || 'Failed to update name');
            }
        } catch (error) {
            console.error("Error submitting name:", error);
        }
    };


     // ✨ 1. Add a new handler function for the download
    const handleDownloadReport = async () => {
        try {
            const res = await authenticatedFetch('http://localhost:3001/api/reports/weekly-summary');
            if (!res.ok) throw new Error("Failed to generate the report.");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `LyraAI_Weekly_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: any) {
            // You can display an error message in the chat
            const errorMessage = {
                id: window.crypto.randomUUID(),
                type: 'ai' as const,
                content: `Sorry, I couldn't generate the report right now: ${error.message}`,
            };
            setMessages((prev: typeof messages) => [...prev, errorMessage]);
        }
    };
    // Function to handle sending a message
   const handleSendMessage = async () => {
    // Trim the message to remove leading/trailing whitespace
    const userMessage = inputValue.trim();
    if (!userMessage || isTyping) return;

    // 1. Add user's message to the chat display
    const newUserMessage = {
        id:window.crypto.randomUUID(),
        type: 'user' as const,
        content: userMessage,
        timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prevMessages: typeof messages) => [...prevMessages, newUserMessage]);
    setInputValue(''); // 2. Clear the input field

    // 3. Set typing indicator
    setIsTyping(true);

    try {
        // Ensure user and wallet address exist
        if (!user || !user.walletAddress) {
            console.error('User or wallet address is missing. Cannot send message to AI.');
            setIsTyping(false);
            return;
        }

        // 4. Send the message to the backend's AI route
        const response = await fetch('http://localhost:3001/api/ai/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage, walletAddress: user.walletAddress }),
        });

        if (!response.ok) {
            throw new Error('Failed to process AI request');
        }

        const data = await response.json();
        const aiReply = data.reply;

        // 5. Add the AI's reply to the chat display
        const newAiMessage = {
            id:window.crypto.randomUUID(),
            type: 'ai' as const,
            content: aiReply,
            timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prevMessages: typeof messages) => [...prevMessages, newAiMessage]);

         if (data.intent?.action === 'generate_report') {
                await handleDownloadReport();
            }
    } catch (error) {
        console.error('Error sending message to AI:', error);
        // Display an error message to the user
        const errorMessage = {
            id: messages.length + 2,
            type: 'ai' as const,
            content: 'Sorry, I am having trouble connecting right now. Please try again later.',
            timestamp: new Date().toLocaleTimeString(),
        };
        setMessages((prevMessages: typeof messages) => [...prevMessages, errorMessage]);
    } finally {
        // 6. Hide typing indicator
        setIsTyping(false);
    }
};

    // Show a loading screen until the user is identified
    if (isLoading || !user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900/40 to-black flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
            </div>
        );
    }

    return (
      // Your existing JSX
      <>
        {showNameModal && user && (
            <NameInputModal 
                onSubmit={handleNameSubmit} 
                walletAddress={user.walletAddress} 
            />
        )}
      
     {/* Header with User Info */}
      <div className="border-b border-purple-700/20 bg-black/70 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/25">
                <Bot className="w-5 h-5 text-black" />
              </div>
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-300 rounded-full border-2 border-black animate-pulse shadow-sm shadow-green-300/50"></div>
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent tracking-wide">
                LyraAI
              </h1>
              <p className="text-sm text-gray-500 font-light">Your Financial AI Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Dashboard Button */}
            <Link href="/dashboard" passHref>
              <div className="relative cursor-pointer group p-2 rounded-full border border-gray-700/50 hover:bg-gray-800/50 transition-colors duration-200">
                <LayoutDashboard className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
                <span className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-800 text-xs text-white rounded py-1 px-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  Dashboard
                </span>
              </div>
            </Link>

            <div className="text-right text-sm">
              <p className="text-white font-bold">{user.name || 'Guest'}</p>
              <p className="text-gray-500 font-mono text-xs">
                {user.walletAddress.slice(0, 6)}...{user.walletAddress.slice(-4)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Name Input Modal */}
      {/* Removed duplicate modal for name input. */}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message: { id: React.Key | null | undefined; type: string; content: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | null | undefined; timestamp: string | number | bigint | boolean | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | React.ReactPortal | Promise<string | number | bigint | boolean | React.ReactPortal | React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | Iterable<React.ReactNode> | null | undefined> | null | undefined; }, index: number) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.type === 'user' ? 'justify-end' : 'justify-start'} ${
                index % 2 === 0 ? 'ml-8' : 'mr-12'
              }`}
            >
              {message.type === 'ai' && (
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-gradient-to-r from-green-600 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30">
                    <Bot className="w-4 h-4 text-black" />
                  </div>
                </div>
              )}
              
              <div
                className={`max-w-xs sm:max-w-md lg:max-w-lg xl:max-w-xl rounded-2xl px-4 py-3 shadow-xl ${
                  message.type === 'user'
                    ? 'bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 shadow-black/50 ml-auto'
                    : 'bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 shadow-black/50'
                }`}
              >
                <p className="text-sm leading-relaxed font-light tracking-wide">{message.content}</p>
                <p className="text-xs text-gray-500 mt-2 opacity-60 font-mono">
                  {message.timestamp}
                </p>
              </div>

              {message.type === 'user' && (
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-gradient-to-r from-cyan-400 to-blue-400 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30">
                    <User className="w-4 h-4 text-black" />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex gap-4 justify-start ml-8">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-cyan-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/30">
                  <Zap className="w-4 h-4 text-black animate-pulse" />
                </div>
              </div>
              <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl px-4 py-3 shadow-xl shadow-black/50">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-purple-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      {!showNameModal && (
        <div className="border-t border-gray-700/30 bg-black/70 backdrop-blur-xl p-4">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
                <div className="flex items-end gap-2 p-3">
                  <textarea
                    value={inputValue}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputValue(e.target.value)}
                    onKeyUp={handleKeyPress}
                    placeholder="Ask me anything about crypto, DeFi, trading strategies..."
                    className="flex-1 bg-transparent text-white placeholder-gray-600 resize-none max-h-32 min-h-[2.5rem] leading-relaxed focus:outline-none font-light tracking-wide"
                    rows={1}
                    style={{
                      scrollbarWidth: 'none',
                      msOverflowStyle: 'none',
                    }}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || isTyping}
                    className="flex-shrink-0 w-10 h-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700/50 rounded-full flex items-center justify-center hover:bg-gray-800/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-105 active:scale-95 shadow-xl shadow-black/50"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
            
            <p className="text-xs text-gray-600 mt-3 text-center font-mono opacity-60">
              Sol-AI is powered by advanced AI. Always verify financial advice and do your own research.
            </p>
          </div>
        </div>
      )}
      </>
    );}
