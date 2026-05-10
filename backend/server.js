import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

import { parseDocument } from "./parser.js";
import { chunkDocument } from "./chunker.js";
import { upsertChunks, searchChunks, clearNamespace, deleteDocumentChunks } from "./vectorDB.js";
import { generateAnswer } from "./ai.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- File Upload Config ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".txt", ".md", ".csv", ".json", ".log"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

// --- Routes ---

app.get("/api/init", (req, res) => {
  res.json({ userId: uuidv4() });
});

/**
 * POST /api/upload
 * Upload a document, parse it, chunk it, and store in Pinecone.
 */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId || userId === "null") {
      return res.status(401).json({ error: "Unauthorized: Missing X-User-Id header" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const docId = uuidv4();
    const docName = req.file.originalname;
    const fileBuffer = req.file.buffer;

    console.log(`\n📄 Processing: ${docName}`);

    // Step 1: Parse document
    console.log("  → Parsing document...");
    const { text, pages } = await parseDocument(fileBuffer, docName);

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Document appears to be empty." });
    }

    // Step 2: Chunk the document
    console.log("  → Chunking document...");
    const chunks = chunkDocument(text, docId, docName, userId, pages);

    // Step 3: Upsert into Pinecone (Pinecone handles embedding via integrated inference)
    console.log("  → Storing in vector database...");
    await upsertChunks(chunks);

    console.log(`  ✅ Done! ${chunks.length} chunks indexed.\n`);

    res.json({
      success: true,
      docId,
      docName,
      chunkCount: chunks.length,
      pageCount: pages?.length || 1,
      textLength: text.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ask
 * Ask a question about uploaded documents.
 * Retrieves relevant chunks and generates a grounded answer.
 */
app.post("/api/ask", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId || userId === "null") return res.status(401).json({ error: "Unauthorized" });

    const { question, chatHistory = [] } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "Question is required." });
    }

    console.log(`\n❓ Question: "${question}"`);

    // Step 1: Retrieve relevant chunks from Pinecone
    console.log("  → Searching vector database...");
    const relevantChunks = await searchChunks(question, 5, userId);

    if (relevantChunks.length === 0) {
      return res.json({
        answer:
          "I couldn't find any relevant information. Please make sure you've uploaded a document first.",
        sources: [],
      });
    }

    console.log(`  → Found ${relevantChunks.length} relevant chunks.`);

    // Step 2: Generate answer using LLM with retrieved context
    console.log("  → Generating answer...");
    const answer = await generateAnswer(question, relevantChunks, chatHistory);

    // Step 3: Return answer with sources
    const sources = relevantChunks.map((c) => ({
      page: c.page,
      score: Math.round(c.score * 100) / 100,
      preview: c.chunk_text.slice(0, 200) + (c.chunk_text.length > 200 ? "..." : ""),
      docName: c.docName,
    }));

    console.log("  ✅ Answer generated.\n");

    res.json({ answer, sources });
  } catch (error) {
    console.error("Ask error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents
 * List all uploaded documents.
 */
app.get("/api/documents", (req, res) => {
  const userId = req.headers["x-user-id"];
  if (!userId || userId === "null") return res.status(401).json({ error: "Unauthorized" });
  res.json({ documents: [] });
});

/**
 * DELETE /api/documents
 * Clear all documents from the vector database.
 */
app.delete("/api/documents", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId || userId === "null") return res.status(401).json({ error: "Unauthorized" });
    await clearNamespace(userId);
    res.json({ success: true, message: "All documents cleared." });
  } catch (error) {
    console.error("Clear error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a specific document from the vector database.
 */
app.delete("/api/documents/:id", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    if (!userId || userId === "null") return res.status(401).json({ error: "Unauthorized" });

    const docId = req.params.id;

    // Delete from vectorDB using docId and userId
    await deleteDocumentChunks(docId, userId);

    res.json({ success: true, message: `Document ${docId} deleted.` });
  } catch (error) {
    console.error("Delete document error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/health
 * Health check endpoint.
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`\n🚀 RAG Backend running at http://localhost:${PORT}`);
  console.log(`   Upload:  POST /api/upload`);
  console.log(`   Ask:     POST /api/ask`);
  console.log(`   Docs:    GET  /api/documents`);
  console.log(`   Health:  GET  /api/health\n`);
});
