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

// ─────────────────────────────────────────────────────────────────────────────
// 6.1  Query Rewriting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fix spelling, improve grammar, and expand a vague user query while
 * preserving the original intent.
 *
 * @param {string} rawQuery
 * @returns {Promise<string>}
 */
async function rewriteQuery(rawQuery) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    messages: [
      {
        role: "system",
        content: `You are a query rewriting assistant. Your job is to:
1. Fix spelling mistakes in the user's query.
2. Improve grammar and clarity.
3. Expand vague or abbreviated queries into a full, detailed question.
4. Preserve the original user intent — do NOT change the topic.

Return ONLY the rewritten query as plain text — no explanation, no quotes, no extra text.`,
      },
      { role: "user", content: rawQuery },
    ],
    temperature: 0.2,
    max_tokens: 256,
  });

  const rewritten = completion.choices[0].message.content?.trim();
  return rewritten && rewritten.length > 0 ? rewritten : rawQuery;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.2  Multi-Query Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate 2–4 semantically diverse variants of a query to improve retrieval
 * coverage. Variants must not duplicate the same meaning.
 *
 * @param {string} query - The (already rewritten) user query
 * @returns {Promise<string[]>} array of variant queries
 */
async function generateMultipleQueries(query) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    messages: [
      {
        role: "system",
        content: `You are a retrieval assistant. Generate 3 diverse, semantically different versions of the user's query to maximize document retrieval coverage.

Rules:
- Each variant should approach the topic from a different angle.
- Do NOT repeat the same meaning.
- Do NOT add introductory text, numbering, or bullet characters.
- Return ONLY the queries, one per line, nothing else.`,
      },
      { role: "user", content: query },
    ],
    temperature: 0.7,
    max_tokens: 256,
  });

  const raw = completion.choices[0].message.content?.trim() || "";
  const variants = raw
    .split("\n")
    .map((l) => l.replace(/^[\d\.\-\*\•]+\s*/, "").trim())
    .filter((l) => l.length > 10 && l !== query);

  // Always include the original + up to 3 variants
  return [query, ...variants.slice(0, 3)];
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.5  LLM-as-a-Judge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether a retrieved chunk is relevant to the user query.
 * Returns "RELEVANT" or "IRRELEVANT".
 *
 * @param {string} query
 * @param {string} chunkText
 * @returns {Promise<"RELEVANT"|"IRRELEVANT">}
 */
async function judgeRelevance(query, chunkText) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    messages: [
      {
        role: "system",
        content: `You are a relevance judge. Given a user query and a document chunk, decide if the chunk is relevant to answering the query.

Respond with EXACTLY one word: RELEVANT or IRRELEVANT. Nothing else.`,
      },
      {
        role: "user",
        content: `Query: ${query}\n\nDocument Chunk:\n${chunkText.slice(0, 800)}`,
      },
    ],
    temperature: 0.0,
    max_tokens: 10,
  });

  const verdict = completion.choices[0].message.content?.trim().toUpperCase();
  return verdict === "RELEVANT" ? "RELEVANT" : "IRRELEVANT";
}

/**
 * Filter a list of chunks to only those judged RELEVANT by the LLM.
 * Runs judgements concurrently for speed.
 *
 * @param {string} query
 * @param {Array} chunks
 * @returns {Promise<Array>} filtered chunks
 */
async function filterRelevantChunks(query, chunks) {
  const judgements = await Promise.all(
    chunks.map((chunk) => judgeRelevance(query, chunk.chunk_text))
  );

  const relevant = chunks.filter((_, i) => judgements[i] === "RELEVANT");
  console.log(
    `  [Judge] ${relevant.length}/${chunks.length} chunks passed relevance filter.`
  );
  return relevant;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.6  Corrective Retrieval — query rewrite helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rewrite a query specifically because initial retrieval returned poor results.
 * More aggressive than the standard rewrite — changes perspective/phrasing.
 *
 * @param {string} query
 * @returns {Promise<string>}
 */
async function rewriteQueryForCorrectiveRetrieval(query) {
  const completion = await client.chat.completions.create({
    model: "google/gemini-2.0-flash-001",
    messages: [
      {
        role: "system",
        content: `The initial document retrieval for this query failed to find relevant results.
Rewrite the query using completely different wording, synonyms, or a different angle to improve retrieval.
Return ONLY the rewritten query as plain text — no explanation.`,
      },
      { role: "user", content: query },
    ],
    temperature: 0.5,
    max_tokens: 256,
  });

  const rewritten = completion.choices[0].message.content?.trim();
  return rewritten && rewritten.length > 0 ? rewritten : query;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.7  Final Answer Generation with Hallucination Prevention
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(chunks) {
  const contextBlock = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1} | ${c.docName} — Page ${c.page}${c.section ? ` | Section: ${c.section}` : ""}]\n${c.chunk_text}`
    )
    .join("\n\n---\n\n");

  return `You are an AI assistant that answers questions **strictly based on the provided document context**.

RULES:
1. Only use information from the CONTEXT below. Do not use your own general knowledge.
2. If the answer is not present in the context, respond with exactly:
   "I could not find this information in the uploaded documents."
3. Never make up facts, statistics, or details not present in the context.
4. Cite the source page number when possible (e.g., "According to page 3, ...").
5. Be concise, accurate, and helpful.
6. Format your answers with proper markdown when appropriate.

CONTEXT:
${contextBlock}`;
}

async function generateAnswer(userQuery, contextChunks, chatHistory = []) {
  const systemPrompt = buildSystemPrompt(contextChunks);

  const formattedHistory = chatHistory.map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: msg.content,
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

export {
  rewriteQuery,
  generateMultipleQueries,
  judgeRelevance,
  filterRelevantChunks,
  rewriteQueryForCorrectiveRetrieval,
  generateAnswer,
};
