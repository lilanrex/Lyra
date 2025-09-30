import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StructuredOutputParser } from 'langchain/output_parsers';
import dotenv from "dotenv";

dotenv.config();
import { getMarketData } from '../backend/marketData.js';
// Unified schema for the AI's output
// in agent.js

const IntentSchema = {
  type: 'Either "finance" (for any financial task) or "general" (for normal chat).',
  
  action: 'For "finance" type. Can be one of: "set_budget", "get_budget", "add_expense","get_surplus", "show_transactions","generate_report", "get_goal","set_goal", "save_surplus", "stake_surplus", "advise_on_surplus", "execute_split".',
  
  amount: 'Numeric amount (if applicable for the action).',
  
  currency: 'Currency code (e.g. "NGN" or "USD", if applicable).',
  
  description: 'Optional description for an intent (e.g., budget period like "weekly", or expense details like "for groceries").',
  
  isRecurring: 'Boolean. True if a "set_budget" action should be recurring (e.g., user says "every week").',
  
  transactionType: 'For "show_transactions" action only. Can be "income", "expense", or "all".',
  
  suggestedSplit: 'An object with percentages, like { "savePercent": 70, "stakePercent": 30 }. Only for "advise_on_surplus" and "execute_split" actions.',
  
  reply: 'A natural, conversational reply for the user. This must always be present.'
};

const parser = StructuredOutputParser.fromNamesAndDescriptions(IntentSchema);

const prompt = new PromptTemplate({
  template: `
    You are LyraAI, Your name is Lyra, a financial assistant and prudent advisor for Solana users.
    
    Here is some context about the user's current financial state and the market:
    ---
    {user_context}
    - User's Goals:
    {userGoalsContext}


    MARKET CONTEXT:
    - SOL Price: {solPrice} USD
    - Marinade Staking APY (Annual): {stakingAPY}%
    - USDC Stablecoin Savings Yield (Annual): {stableYield}%
    - 24h SOL Market Volatility: {volatility}%
    ---
    
    Based on that context and the user's message, you must handle **two types of messages**:

    1.  Finance-related (budgeting, expenses, savings, staking).
        → Extract structured data (action, amount, currency, description).
        → Your reply should be context-aware. For example, if they ask "how am I doing?", use the budget and balance to answer.
         - If the user ASKS A QUESTION about their budget (e.g., "what is my budget?", "do I have a budget?"), set the action to "get_budget".
      - If the user GIVES A COMMAND to create or change a budget (e.g., "set my budget to 500", "change my budget to 100k weekly"), set the action to "set_budget" and extract all details.
        → If the user mentions a recurring or repeating budget, set isRecurring to true.
         **Report Generation**: If the user asks for a report, statement, or summary of their transactions (e.g., "send me my weekly report", "download my transactions", "print my weekly transactions", "Give me a pdf of my reports"), set the action to "generate_report".
        → **ADVISOR TASK**: If the user asks for advice on their surplus ("how should I manage my surplus?", "save more or stake more?"), analyze their goals and the market data. Prioritize savings (USDC) for short-term goals and staking (SOL) for long-term growth, explaining the risks and rewards. Provide your advice in the "reply" and a structured split in "suggestedSplit". Set the action to "advise_on_surplus".
       **Execute a Command**: If the user gives a direct COMMAND (e.g., "stake my surplus", "save what's left") or confirms your previous advice ("yes, do it"), set the action to "execute_split".
        - If it's a direct command for a single action, you MUST populate the "suggestedSplit" field with 100% for that action (e.g., for "stake it all", use {{"savePercent": 0, "stakePercent": 100}}).
        - If the user is confirming previous advice, you do not need to populate "suggestedSplit", as the system will remember it.
        → Reply naturally in "reply".

    2.  General chat (small talk, questions not about money).
        → Do NOT force budget fields.
        → Set "type": "general", leave finance fields empty,
        but ALWAYS include a helpful conversational "reply".

    Respond ONLY with valid JSON in this schema:

    {format_instructions}

    Message: "{input}"
  `,
  inputVariables: ['input', 'user_context',   'userGoalsContext',
    'solPrice',
    'stakingAPY',
    'stableYield',
    'volatility'],
  partialVariables: {
    format_instructions: parser.getFormatInstructions(),
  },
});

const model = new ChatOpenAI({
  model: 'gpt-4.1-mini',
  temperature: 0,
  maxTokens: 800,
  apiKey: process.env.OPEN_AI_KEY,
});

export async function parseIntent(input, user) {
  try {
    // --- Start: Build the Context String ---
    let contextParts = [];
    const marketData = await getMarketData();

    let userGoalsContext = "  User has not set any specific goals.";


    if (user?.balance !== null && user?.balance !== undefined) {
      contextParts.push(`- User's current wallet balance is ${user.balance.toFixed(4)} SOL.`);
    } else {
      contextParts.push("- User's wallet balance is not available.");
    }

    // Determine the user's budget currency, defaulting to NGN
    const budgetCurrency = user?.budget?.currency || 'NGN';

    // 2. Add budget context
    if (user?.budget) {
      const budget = user.budget;
      const budgetAgeInDays = (new Date() - new Date(budget.createdAt)) / (1000 * 60 * 60 * 24);
      
      let period = "monthly"; // Default assumption
      if (budgetAgeInDays <= 7) {
        period = "weekly";
      }

      contextParts.push(`- The user has set a ${period} budget of ${budget.amount} ${budget.currency}.`);
      contextParts.push(`- The budget was set ${Math.floor(budgetAgeInDays)} days ago.`);
    } else {
      contextParts.push("- The user has not set a budget yet.");
    }

    // 3. Add improved income/expense context
    if (user?.expenses?.length > 0) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
      const recentTransactions = user.expenses.filter(
        (tx) => new Date(tx.createdAt) > sevenDaysAgo
      );

      if (recentTransactions.length > 0) {
        // Calculate totals for both income and expenses in one pass
        const summary = recentTransactions.reduce((acc, tx) => {
          const amount = budgetCurrency === 'USD' ? (tx.amountUSD || 0) : (tx.amountNGN || 0);
          
          if (tx.type === 'expense') {
            acc.totalSpent += amount;
            acc.expenseCount++;
          } else if (tx.type === 'income') {
            acc.totalEarned += amount;
            acc.incomeCount++;
          }
          return acc;
        }, { totalSpent: 0, expenseCount: 0, totalEarned: 0, incomeCount: 0 });

        // ✨ --- ADDED: Surplus Calculation Logic --- ✨
        if (user?.budget) {
            const surplus = user.budget.amount - summary.totalSpent;
            contextParts.push(
                `- Based on the budget and recent spending, the user has a surplus of ~${surplus.toFixed(2)} ${budgetCurrency}.`
            );
        }

        // Add context based on what was found
        if (summary.expenseCount > 0) {
          contextParts.push(
            `- In the last 7 days, the user has spent ~${summary.totalSpent.toFixed(2)} ${budgetCurrency} across ${summary.expenseCount} transactions.`
          );
        }
        if (summary.incomeCount > 0) {
          contextParts.push(
            `- In the last 7 days, the user has received ~${summary.totalEarned.toFixed(2)} ${budgetCurrency} across ${summary.incomeCount} transactions.`
          );
        }
      } else {
        contextParts.push("- The user has no recorded transactions in the last 7 days.");
      }
    } else {
      contextParts.push("- The user has no recorded transactions yet.");
    }
    
    const userContext = contextParts.join('\n');
    if (user.goals && user.goals.length > 0) {
            userGoalsContext = user.goals.map(g => 
                `  - ${g.name} (${g.type}): ${g.currentAmount.toLocaleString()}/${g.targetAmount.toLocaleString()}`
            ).join('\n');
        }
    // --- End: Build the Context String ---

    const promptValue = await prompt.format({
      input: input,
      user_context: userContext,
      userGoalsContext: userGoalsContext,
      solPrice: (marketData.solPrice || 0).toFixed(2),
      stakingAPY: (marketData.stakingAPY || 0).toFixed(2),
      stableYield: (marketData.stableYield || 0).toFixed(2),
      volatility: (marketData.volatility || 0).toFixed(2)
    });

    const response = await model.invoke(promptValue);

    console.log("Raw LLM response:", response.content);

     let cleanedRes = response.content.trim();
    // Find the first '{' and the last '}' to extract the JSON object.
    const firstBrace = cleanedRes.indexOf('{');
    const lastBrace = cleanedRes.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error("Could not find a valid JSON object in the AI response.");
    }
    cleanedRes = cleanedRes.substring(firstBrace, lastBrace + 1);

    const result = await parser.parse(cleanedRes);

    // Normalize finance fields
    if (result.type === "finance") {
      result.amount = result.amount ? Number(result.amount) : null;
      result.currency = result.currency?.toUpperCase() === "USD" ? "USD" : "NGN";
    }

    

    return result;
  } catch (err) {
    console.error("AI parsing Error (full):", err);

    // Always return a safe general response if parsing fails
    return {
      type: "general",
      action: "",
      amount: "",
      currency: "",
      description: "",
      reply: "Sorry, I couldn’t process that. Can you try again?",
    };
  }
}

