# 🧠 DocMind — Enhanced Production-Grade RAG System

DocMind is a full-stack, production-ready Retrieval-Augmented Generation (RAG) application built to simulate real-world AI retrieval behavior. It goes beyond basic vector search by implementing an intelligent multi-stage pipeline: query rewriting, multi-query generation, hybrid retrieval (BM25 + semantic), LLM-as-a-Judge relevance filtering, and a corrective retrieval loop — all with full transparency surfaced in the UI.

Powered by **Gemini 2.0 Flash** (via OpenRouter) and **Pinecone Serverless**, with a React + TypeScript frontend.

---

## ✨ Features

### 🔧 Enhanced RAG Pipeline (PRD §6.1–6.7)

| Feature | Description |
|---------|-------------|
| **§6.1 Query Rewriting** | Automatically fixes spelling mistakes, expands vague queries, and improves grammar before retrieval — preserving user intent |
| **§6.2 Multi-Query Generation** | Generates 3 semantically diverse variants of the rewritten query to maximize retrieval coverage |
| **§6.3 Advanced Chunking** | Section-aware chunking that detects headings (markdown, numbered, ALL CAPS) and stores `section`, `chunk_id`, `page`, and `source` metadata per chunk |
| **§6.4 Hybrid Retrieval** | Fuses vector similarity search with BM25 keyword scoring via Reciprocal Rank Fusion (RRF) — handles exact syntax, abbreviations, and numbers that semantic search misses |
| **§6.5 LLM-as-a-Judge** | Evaluates each retrieved chunk for relevance before generation — filters noisy context and reduces hallucinations |
| **§6.6 Corrective RAG Loop** | If all chunks are irrelevant, rewrites the query from a new angle and retries retrieval (max 2 retries, prevents infinite loops) |
| **§6.7 Hallucination Prevention** | System prompt strictly confines the LLM to provided context; responds with `"I could not find this information in the uploaded documents."` when unsupported |
| **§6.8 Indexing Status** | Step-by-step upload progress overlay: Uploading → Parsing → Chunking → Creating Embeddings → Saving to Vector DB → Complete |
| **§6.9 Error Handling** | Gracefully handles empty docs, scanned PDFs, malformed CSVs, unsupported formats, embedding rate limits, API timeouts, and auth failures |

### 🏗️ Core Foundation

- **Multi-Tenant Isolation:** Each user's vectors are isolated using `userId` metadata filtering in Pinecone — no cross-user data leakage
- **Integrated Inference:** Pinecone's `llama-text-embed-v2` embeds text automatically — no separate embedding service needed
- **Conversational Memory:** Full chat history is injected into the LLM prompt for intelligent follow-up questions
- **Rate-Limit Resilience:** Automatic 60s backoff on Pinecone free-tier rate limits during large document uploads
- **Client-Side Persistence:** Chat history and document registry stored in `localStorage` — zero backend state
- **Pipeline Transparency:** Every assistant response shows a collapsible "⚙️ Pipeline details" panel revealing the rewritten query, query variants, chunks retrieved vs. after judge, and corrective loop attempts
- **Dark / Light Mode:** System-preference-aware with manual toggle

---

## 🛠️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Vanilla CSS |
| **Backend** | Node.js, Express 5, Multer |
| **Vector Database** | Pinecone Serverless (integrated `llama-text-embed-v2`) |
| **LLM** | Gemini 2.0 Flash via OpenRouter |
| **Document Parsing** | `pdf-parse` (per-page extraction) |
| **Retrieval** | Hybrid: Pinecone vector search + in-process BM25 + RRF fusion |

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js v18+
- A [Pinecone](https://pinecone.io/) account and API key
- An [OpenRouter](https://openrouter.ai/) account and API key

### 1. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend/` directory:

```env
PINECONE_API_KEY=your_pinecone_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
PORT=3001
```

Start the server:

```bash
npm run dev
```

You should see:

```
🚀 Enhanced RAG Backend running at http://localhost:3001
  ✅ §6.1 Query Rewriting
  ✅ §6.2 Multi-Query Generation
  ✅ §6.3 Advanced Metadata-Aware Chunking
  ✅ §6.4 Hybrid Retrieval (Semantic + BM25/RRF)
  ✅ §6.5 LLM-as-a-Judge
  ✅ §6.6 Corrective RAG Loop (max 2 retries)
  ✅ §6.7 Hallucination Prevention Prompt
  ✅ §6.8 Upload Status Steps
  ✅ §6.9 Comprehensive Error Handling
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 📖 How to Use

1. **Upload Documents** — Click `+` in the **Documents** sidebar. Supports `.pdf`, `.txt`, `.md`, `.csv`, `.json`, `.log` (up to 50 MB). Watch the 6-step progress overlay as the document is parsed, chunked, and indexed.

2. **Ask Questions** — Type naturally, even with typos or vague phrasing. The pipeline automatically rewrites your query, generates variants, runs hybrid retrieval, judges relevance, and may self-correct before answering.

3. **Inspect the Pipeline** — Click **⚙️ Pipeline details** under any assistant response to see:
   - How your query was rewritten
   - How many query variants were generated
   - How many chunks were retrieved vs. passed the LLM judge
   - Whether a corrective loop was triggered

4. **View Citations** — Click **📚 Sources** to see the exact document, page, section, and chunk ID used. Sources include hybrid match scores.

5. **Manage Chats & Docs** — Use `+` to start new chats; `×` to delete chats or documents (deletion removes vectors from Pinecone).

> **Note:** On a free Pinecone tier, uploading large documents (200+ pages) may trigger a 60-second automatic backoff — the app will handle this transparently.

---

## 🏛️ Architecture

```
User Query
      ↓
 Query Rewriting (§6.1)        ← fix typos, expand vague queries
      ↓
 Multi-Query Generation (§6.2) ← 3 semantic variants
      ↓
 Hybrid Retrieval (§6.4)
   ├── Semantic Search × N queries (Pinecone)
   └── BM25 Keyword Scoring
         ↓  Reciprocal Rank Fusion
      Top-8 Candidates
      ↓
 LLM-as-a-Judge (§6.5)         ← per-chunk relevance filter
      ↓
 All irrelevant? → Corrective Loop (§6.6) → retry (max 2×)
      ↓
 Final LLM Generation (§6.7)   ← context-only, hallucination-guarded
      ↓
 Answer + Sources + Pipeline Metadata
```

---

## 📁 Project Structure

```
Assignment/
├── backend/
│   ├── server.js      # Express API + full enhanced pipeline orchestration
│   ├── ai.js          # Query rewriting, multi-query, LLM judge, answer generation
│   ├── chunker.js     # Section-aware chunking with metadata extraction
│   ├── vectorDB.js    # Pinecone upsert + hybrid search (BM25 + RRF)
│   ├── parser.js      # PDF (per-page) and plain text parsing
│   └── .env           # API keys (not committed)
└── frontend/
    └── src/
        ├── App.tsx    # Main React app with pipeline UI + upload progress
        └── App.css    # Styling for all enhanced features
```

---

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/init` | Generate a new user ID |
| `POST` | `/api/upload` | Upload and index a document |
| `POST` | `/api/ask` | Run the full enhanced RAG pipeline |
| `GET` | `/api/documents` | List documents (client-managed) |
| `DELETE` | `/api/documents` | Clear all documents for a user |
| `DELETE` | `/api/documents/:id` | Delete a specific document |
| `GET` | `/api/health` | Health check |

The `/api/ask` response includes a `pipeline` object:

```json
{
  "answer": "...",
  "sources": [...],
  "pipeline": {
    "originalQuery": "how debug node",
    "rewrittenQuery": "How to debug a Node.js application?",
    "queriesGenerated": 4,
    "chunksRetrieved": 8,
    "chunksAfterJudge": 3,
    "correctiveAttempts": 0
  }
}
```
