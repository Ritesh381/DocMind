# 🧠 DocMind - Multi-Tenant RAG Dashboard

DocMind is a robust, full-stack Retrieval-Augmented Generation (RAG) web application. It allows multiple users to upload documents (PDFs, text) and chat with an AI (powered by Gemini 2.0 Flash) that securely answers questions strictly based on the uploaded context. 

Designed with a clean, Claude.ai-inspired interface, it natively supports multi-tenant document isolation, conversational memory, and fully automated vector storage.

## ✨ Features

- **Multi-Tenant Architecture:** Securely isolates vectors and documents using `userId` metadata filtering in Pinecone, allowing multiple users to use the app simultaneously without cross-contamination.
- **Integrated Inference:** Uses Pinecone's serverless Integrated Inference (`llama-text-embed-v2`) to automatically embed documents without needing a standalone embedding model.
- **Smart Chunking:** Employs recursive character-level text splitting with configurable overlaps to maintain semantic context across document boundaries.
- **Conversational Memory:** Preserves complete chat histories via `localStorage` and injects prior context into the LLM prompt for intelligent follow-up questions.
- **Rate-Limit Resilience:** Features an automatic exponential backoff system that gracefully handles Pinecone free-tier rate limits during large document uploads (e.g., 200+ page books).
- **Client-Side Registry:** Eliminates backend state entirely. Document registries and chat histories are securely persisted locally via browser `localStorage`.
- **Dynamic Theming:** Built-in Light and Dark mode toggles.

## 🛠️ Technology Stack

- **Frontend:** React, TypeScript, Vite, Vanilla CSS.
- **Backend:** Node.js, Express, Multer (In-Memory Buffer Storage).
- **Vector Database:** Pinecone Serverless.
- **LLM Engine:** Gemini 2.0 Flash (routed via OpenRouter).
- **Document Parsing:** `pdf-parse`.

---

## 🚀 Setup & Installation

### Prerequisites
- Node.js (v18+ recommended)
- A [Pinecone](https://pinecone.io/) account and API key.
- An [OpenRouter](https://openrouter.ai/) account and API key (for LLM generation).

### 1. Backend Setup
1. Open a terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the `backend` directory and add your API keys:
   ```env
   PINECONE_API_KEY=your_pinecone_api_key_here
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   PORT=3001
   ```
4. Start the backend server:
   ```bash
   npm run dev
   ```

### 2. Frontend Setup
1. Open a new terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

---

## 📖 How to Use

1. **Access the App:** Open your browser and navigate to `http://localhost:5173`.
2. **Upload Documents:** Click the `+` button in the **Documents** sidebar section. You can upload PDFs, markdown files, CSVs, or log files.
   - *Note: If uploading massive books on a free Pinecone tier, the backend will automatically pause for 60 seconds intermittently to bypass rate limits. Just leave the app running!*
3. **Ask Questions:** Type a question in the chat input. DocMind will retrieve the most relevant 5 chunks from your uploaded documents and generate an accurate response.
4. **Manage Chats:** Click the `+` in the **Chats** section to start a clean conversational thread. Click the `×` on any chat or document to permanently delete it.
5. **View Citations:** When DocMind answers a question, click the `📚 Sources` dropdown under the message to see exactly which document and page the answer was sourced from.
