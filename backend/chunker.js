import { v4 as uuidv4 } from "uuid";

/**
 * CHUNKING STRATEGY: Recursive Character Text Splitting with Overlap
 * ===================================================================
 *
 * This module implements a recursive character-level text splitting strategy,
 * inspired by LangChain's RecursiveCharacterTextSplitter.
 *
 * HOW IT WORKS:
 * 1. The document text is first split by pages (using page breaks from PDF parsing).
 * 2. Each page's text is then split into chunks of a target size (~800 characters)
 *    using a hierarchy of separators: paragraphs → sentences → words.
 * 3. An overlap of ~150 characters is maintained between adjacent chunks to
 *    preserve context across chunk boundaries.
 *
 * WHY THIS STRATEGY:
 * - Paragraph-first splitting preserves semantic coherence within chunks.
 * - Sentence-level fallback ensures no chunk exceeds the target size.
 * - Overlap prevents information loss at chunk boundaries, improving retrieval.
 * - Page metadata is preserved for citation purposes.
 *
 * PARAMETERS:
 * - CHUNK_SIZE: 800 characters (balances semantic density vs embedding quality)
 * - CHUNK_OVERLAP: 150 characters (enough context bleed for boundary queries)
 */

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;

/**
 * Split text recursively using a hierarchy of separators.
 *
 * @param {string} text
 * @param {number} chunkSize
 * @param {number} overlap
 * @returns {string[]}
 */
function recursiveSplit(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  // If text fits in one chunk, return it
  if (text.length <= chunkSize) {
    return [text.trim()].filter((t) => t.length > 0);
  }

  // Try splitting by paragraphs first, then sentences, then words
  const separators = ["\n\n", "\n", ". ", " "];

  for (const sep of separators) {
    const parts = text.split(sep);
    if (parts.length <= 1) continue;

    const chunks = [];
    let currentChunk = "";

    for (const part of parts) {
      const candidate = currentChunk
        ? currentChunk + sep + part
        : part;

      if (candidate.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        // Start next chunk with overlap from the end of the current one
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + sep + part;
      } else {
        currentChunk = candidate;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    if (chunks.length > 0) {
      return chunks;
    }
  }

  // Fallback: hard split by character
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize).trim());
  }
  return chunks.filter((t) => t.length > 0);
}

/**
 * Process a parsed document into chunks ready for vector storage.
 *
 * @param {string} text - Full document text
 * @param {string} docId - Unique document identifier
 * @param {string} docName - Original filename
 * @param {string} userId - User ID
 * @param {Array<{pageNum: number, text: string}>|null} pages - Optional page-level splits
 * @returns {Array<{id: string, chunk_text: string, page: number, docId: string, docName: string, userId: string}>}
 */
function chunkDocument(text, docId, docName, userId, pages = null) {
  const allChunks = [];

  if (pages && pages.length > 0) {
    // Process page by page to preserve page numbers
    for (const page of pages) {
      if (!page.text || page.text.trim().length === 0) continue;

      const textChunks = recursiveSplit(page.text);
      for (const chunkText of textChunks) {
        allChunks.push({
          id: uuidv4(),
          chunk_text: chunkText,
          page: page.pageNum,
          docId,
          docName,
          userId,
        });
      }
    }
  } else {
    // No page info — treat as a single-page document
    const textChunks = recursiveSplit(text);
    for (const chunkText of textChunks) {
      allChunks.push({
        id: uuidv4(),
        chunk_text: chunkText,
        page: 1,
        docId,
        docName,
        userId,
      });
    }
  }

  console.log(
    `Chunked "${docName}" into ${allChunks.length} chunks (avg ${Math.round(
      allChunks.reduce((sum, c) => sum + c.chunk_text.length, 0) /
        allChunks.length
    )} chars/chunk)`
  );

  return allChunks;
}

export { chunkDocument, recursiveSplit, CHUNK_SIZE, CHUNK_OVERLAP };
