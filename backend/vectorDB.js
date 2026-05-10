import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = "genai-assignment";

/**
 * Ensure the Pinecone index exists. Uses Pinecone's integrated inference
 * so we don't need to generate embeddings ourselves — Pinecone will
 * embed text automatically via the `llama-text-embed-v2` model.
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

/**
 * Upsert document chunks into Pinecone.
 * Each record contains chunk_text for embedding + page metadata.
 *
 * @param {Array<{id: string, chunk_text: string, page: number, docId: string, docName: string}>} chunks
 */
async function upsertChunks(chunks, namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);

  const records = chunks.map((chunk) => ({
    _id: chunk.id,
    chunk_text: chunk.chunk_text,
    page: chunk.page,
    docId: chunk.docId,
    docName: chunk.docName,
    userId: chunk.userId,
  }));

  // Helper for rate limits (250k tokens/min)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function upsertBatchWithRetry(batch, retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await ns.upsertRecords({ records: batch });
        return;
      } catch (err) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes("429"));
        if (isRateLimit && attempt < retries) {
          console.warn(`[Pinecone] Rate limit hit. Waiting 60s before retry ${attempt}/${retries}...`);
          await sleep(61000); // 61 seconds to clear the 1-minute window
        } else {
          throw err;
        }
      }
    }
  }

  // Upsert in batches of 96 (Pinecone's recommended batch size for integrated inference)
  const BATCH_SIZE = 96;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await upsertBatchWithRetry(batch);
    console.log(
      `Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(records.length / BATCH_SIZE)}`,
    );
  }

  console.log(`Upserted ${records.length} chunks total.`);
}

/**
 * Search for the most relevant chunks given a user query.
 * Pinecone handles embedding the query via integrated inference.
 *
 * @param {string} query - The user's question
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array<{id: string, score: number, chunk_text: string, page: number}>>}
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
    fields: ["chunk_text", "page", "docName"],
  });

  return (results.result?.hits || []).map((hit) => ({
    id: hit._id,
    score: hit._score,
    chunk_text: hit.fields?.chunk_text || "",
    page: hit.fields?.page || 0,
    docName: hit.fields?.docName || "",
  }));
}

/**
 * Delete all vectors in a namespace (used when re-uploading a document).
 */
async function clearNamespace(namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);
  await ns.deleteAll();
  console.log(`Cleared namespace "${namespace}".`);
}

/**
 * Delete chunks belonging to a specific document.
 */
async function deleteDocumentChunks(docId, userId, namespace = "default") {
  const index = await ensureIndex();
  const ns = index.namespace(namespace);

  await ns.deleteMany({ filter: { docId: docId, userId: userId } });
  console.log(
    `Deleted chunks for document ID: "${docId}" and userId: "${userId}".`,
  );
}

export {
  ensureIndex,
  upsertChunks,
  searchChunks,
  clearNamespace,
  deleteDocumentChunks,
};
