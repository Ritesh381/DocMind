import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = "genai-assignment";

// ─────────────────────────────────────────────────────────────────────────────
// Index Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure the Pinecone index exists. Uses Pinecone's integrated inference
 * so we don't need to generate embeddings ourselves — Pinecone will embed
 * text automatically via the `llama-text-embed-v2` model.
 */
async function ensureIndex() {
  const existing = await pc.listIndexes();
  const exists = existing.indexes?.some((idx) => idx.name === INDEX_NAME);

  if (!exists) {
    console.log(`Creating Pinecone index "${INDEX_NAME}"...`);
    await pc.createIndexForModel({
      name: INDEX_NAME,
      cloud: "aws",
      region: "us-east-1",
      embed: {
        model: "llama-text-embed-v2",
        fieldMap: { text: "chunk_text" },
      },
      waitUntilReady: true,
    });
    console.log("Index created.");
  } else {
    console.log(`Pinecone index "${INDEX_NAME}" already exists.`);
  }

  return pc.index(INDEX_NAME);
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert document chunks into Pinecone.
 * Each record contains chunk_text (embedded by Pinecone) + rich metadata.
 *
 * @param {Array<{id, chunk_text, page, section, docId, docName, userId, chunk_id}>} chunks
 */
async function upsertChunks(chunks, namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);

  const records = chunks.map((chunk) => ({
    _id: chunk.id,
    chunk_text: chunk.chunk_text,
    page: chunk.page,
    section: chunk.section || "",
    chunk_id: chunk.chunk_id || chunk.id,
    docId: chunk.docId,
    docName: chunk.docName,
    userId: chunk.userId,
  }));

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function upsertBatchWithRetry(batch, retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await ns.upsertRecords({ records: batch });
        return;
      } catch (err) {
        const isRateLimit =
          err.status === 429 || (err.message && err.message.includes("429"));
        if (isRateLimit && attempt < retries) {
          console.warn(
            `[Pinecone] Rate limit hit. Waiting 60s before retry ${attempt}/${retries}...`
          );
          await sleep(61000);
        } else {
          throw err;
        }
      }
    }
  }

  const BATCH_SIZE = 96;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await upsertBatchWithRetry(batch);
    console.log(
      `Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
        records.length / BATCH_SIZE
      )}`
    );
  }

  console.log(`Upserted ${records.length} chunks total.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Search — Semantic (Vector)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Semantic vector search against Pinecone.
 *
 * @param {string} query
 * @param {number} topK
 * @param {string} userId
 * @param {string} namespace
 * @returns {Promise<Array>}
 */
async function searchChunks(query, topK = 5, userId, namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);

  const results = await ns.searchRecords({
    query: {
      topK,
      inputs: { text: query },
    },
    filter: { userId: userId },
    fields: ["chunk_text", "page", "docName", "section", "chunk_id"],
  });

  return (results.result?.hits || []).map((hit) => ({
    id: hit._id,
    score: hit._score,
    chunk_text: hit.fields?.chunk_text || "",
    page: hit.fields?.page || 0,
    docName: hit.fields?.docName || "",
    section: hit.fields?.section || "",
    chunk_id: hit.fields?.chunk_id || hit._id,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// §6.4  Hybrid Retrieval — BM25 Keyword + Semantic Fusion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple in-process BM25-style keyword scorer.
 * We don't have access to a full index here, so we approximate BM25 by scoring
 * retrieved chunks against the query using term-frequency + IDF approximation.
 *
 * k1 = 1.5, b = 0.75 (standard BM25 defaults)
 */
function bm25Score(queryTerms, docText, avgDocLen) {
  const k1 = 1.5;
  const b = 0.75;
  const docLen = docText.length;
  const lowerDoc = docText.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    const lowerTerm = term.toLowerCase();
    // Term frequency in doc (rough: count occurrences / doc length)
    const tf = (lowerDoc.split(lowerTerm).length - 1);
    if (tf === 0) continue;
    // Simplified IDF (we treat all terms as moderately rare)
    const idf = Math.log(1 + 1 / (tf + 0.5));
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}

/**
 * Hybrid Retrieval: runs multiple semantic queries (from multi-query generation)
 * then re-ranks with BM25 keyword scoring and merges results using Reciprocal
 * Rank Fusion (RRF).
 *
 * @param {string[]} queries - Original query + variants
 * @param {number} topK - Final number of results
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function hybridSearch(queries, topK = 6, userId) {
  const k = 60; // RRF constant

  // 1. Run all queries in parallel — over-fetch to have enough candidates
  const perQuery = Math.max(topK, 5);
  const allResultSets = await Promise.all(
    queries.map((q) => searchChunks(q, perQuery, userId))
  );

  // 2. Collect unique chunks by id
  const chunkMap = new Map();
  for (const results of allResultSets) {
    for (const chunk of results) {
      if (!chunkMap.has(chunk.id)) chunkMap.set(chunk.id, chunk);
    }
  }

  const uniqueChunks = Array.from(chunkMap.values());

  if (uniqueChunks.length === 0) return [];

  // 3. Reciprocal Rank Fusion across semantic result sets
  const rrfScores = new Map(); // chunk.id → rrf_score

  for (const results of allResultSets) {
    results.forEach((chunk, rank) => {
      const prev = rrfScores.get(chunk.id) || 0;
      rrfScores.set(chunk.id, prev + 1 / (k + rank + 1));
    });
  }

  // 4. BM25 keyword scoring — re-rank the unique pool
  const queryTerms = queries[0]
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);

  const avgDocLen =
    uniqueChunks.reduce((s, c) => s + c.chunk_text.length, 0) / uniqueChunks.length;

  // 5. Combine: 70% semantic (RRF) + 30% keyword (BM25), normalised
  const maxRRF = Math.max(...Array.from(rrfScores.values())) || 1;

  const scored = uniqueChunks.map((chunk) => {
    const semanticScore = (rrfScores.get(chunk.id) || 0) / maxRRF;
    const keywordScore = queryTerms.length > 0
      ? bm25Score(queryTerms, chunk.chunk_text, avgDocLen)
      : 0;
    const maxKW = 10; // normalise BM25 to ~[0,1]
    const combined = 0.7 * semanticScore + 0.3 * Math.min(keywordScore / maxKW, 1);
    return { ...chunk, hybridScore: combined };
  });

  // 6. Sort descending and return top-K
  scored.sort((a, b) => b.hybridScore - a.hybridScore);
  return scored.slice(0, topK);
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace Utilities
// ─────────────────────────────────────────────────────────────────────────────

async function clearNamespace(namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);
  await ns.deleteAll();
  console.log(`Cleared namespace "${namespace}".`);
}

async function deleteDocumentChunks(docId, userId, namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);
  await ns.deleteMany({ filter: { docId: docId, userId: userId } });
  console.log(
    `Deleted chunks for document ID: "${docId}" and userId: "${userId}".`
  );
}

export {
  ensureIndex,
  upsertChunks,
  searchChunks,
  hybridSearch,
  clearNamespace,
  deleteDocumentChunks,
};
