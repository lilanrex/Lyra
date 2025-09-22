// backend/services/aiCategorizer.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const categorizeTx = async (tx) => {
  const prompt = `
You are a financial assistant. Categorize this transaction.

Transaction:
- Token: ${tx.token}
- Amount: ${tx.amount}
- To: ${tx.to}
- Memo: ${tx.memo ?? "None"}

Categories: [Groceries, Transport, Bills, Entertainment, Transfers, Other]

Respond with ONLY one category.
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  return resp.choices[0].message?.content?.trim() || "Other";
};
