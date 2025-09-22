// components/AutoSignerModal.tsx
import React from "react";
import { useRouter } from 'next/navigation';

interface Props {
  isOpen: boolean;
  onChoice: (choice: "manual" | "auto") => void;
  walletAddress: string;
}

export default function AutoSignerModal({ isOpen, onChoice, walletAddress }: Props) {
  const router = useRouter();

  if (!isOpen) return null;

  const handleChoice = async (choice: "manual" | "auto") => {
    if (choice === "auto") {
      // Call the parent's onChoice to handle the challenge/verify flow
      onChoice(choice);
    } else {
      // For manual signing, redirect to chat with wallet address
      router.push(`/chat?wallet=${encodeURIComponent(walletAddress)}&mode=manual`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-purple-700/40 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
        <h2 className="text-2xl font-bold text-purple-300">Choose Signing Mode</h2>
        <p className="text-sm text-gray-400 mt-3">
          LyraAI can either ask you to sign every transaction, 
          or automatically sign on your behalf via our backend.
        </p>

        <div className="flex flex-col gap-4 mt-8">
          <button
            className="px-6 py-3 rounded-xl bg-green-600/90 hover:bg-green-700 transition"
            onClick={() => handleChoice("auto")}
          >
            ✅ Auto-Sign (AI Agent)
          </button>
          <button
            className="px-6 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 transition"
            onClick={() => handleChoice("manual")}
          >
            ✋ Manual Signing
          </button>
        </div>
      </div>
    </div>
  );
}