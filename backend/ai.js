import { OpenAI } from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "http://localhost",
    "X-Title": "rag-notebooklm",
  },
});

function buildSystemPrompt(chunks) {
  const contextBlock = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1} | ${c.docName} — Page ${c.page}]\n${c.chunk_text}`,
    )
    .join("\n\n---\n\n");

  return `You are an AI assistant that answers questions **strictly based on the provided document context**.

RULES:
1. Only use information from the CONTEXT below. Do not use your own general knowledge.
2. If the answer is not in the context, say: "I couldn't find the answer in the uploaded document."
3. Cite the source page number when possible (e.g., "According to page 3, ...").
4. Be concise, accurate, and helpful.
5. Format your answers with proper markdown when appropriate.

CONTEXT:
${contextBlock}`;
}

async function generateAnswer(userQuery, contextChunks, chatHistory = []) {
  const systemPrompt = buildSystemPrompt(contextChunks);

  // Format history messages
  const formattedHistory = chatHistory.map(msg => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: msg.content
  }));

  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    messages: [
      { role: "system", content: systemPrompt },
      ...formattedHistory,
      { role: "user", content: userQuery },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });

  return completion.choices[0].message.content;
}

export { generateAnswer };
