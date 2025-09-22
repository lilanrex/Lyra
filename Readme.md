# LyraAI

LyraAI is an **AI-powered financial assistant on Solana** that helps students manage money in a simple, conversational way.  
It tracks spending, identifies surplus, and turns that surplus into **savings** or **staking investments**—all through natural chat.  

## ✨ Features
- Chat-based budgeting with AI
- Track income, expenses, and surplus
- Set **Savings Goals** (e.g. "Save $200 for a new bike")
- Set **Investment Goals** (e.g. "Stake SOL for growth")
- End-of-period recommendations: LyraAI advises how to split your surplus
- One-click / one-command on-chain execution

## 🚀 Demo Flow
1. Record expenses and income via chat.
2. Ask LyraAI: *“What should I do with my surplus?”*
3. LyraAI suggests an allocation (e.g. *“Save $50 towards your bike, stake $30 in SOL”*).
4. Confirm → LyraAI executes on-chain transactions (USDC savings + SOL staking).

## 🛠️ Tech Stack
- **Frontend:** React + Tailwind + shadcn (chat + dashboard)
- **AI Layer:** LLM for intent parsing + financial recommendations
- **Backend:** Node.js/Express API for orchestration
- **Blockchain:** Solana (`@solana/web3.js`, `@solana/spl-token`)
- **Integrations:** Marinade (staking), USDC transfers

## 🎯 Why LyraAI?
Managing money shouldn’t be complicated.  
LyraAI makes it **as easy as chatting with a friend**, while still giving students access to **real on-chain financial tools**.

---
