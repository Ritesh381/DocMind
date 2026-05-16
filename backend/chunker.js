import { v4 as uuidv4 } from "uuid";

/**
 * CHUNKING STRATEGY: Advanced Semantic + Metadata-Aware Chunking
 * ===============================================================
 *
 * PRD §6.3 — Advanced Chunking System
 *
 * Enhancements over the basic recursive splitter:
 *
 * 1. SECTION-AWARE: Detects markdown headings, numbered headings, and
 *    ALL-CAPS lines as section boundaries and stores the current section
 *    title in chunk metadata.
 *
 * 2. METADATA-RICH: Every chunk carries:
 *      chunk_id   — unique stable identifier
 *      page       — source page number
 *      section    — inferred section/heading title
 *      source     — original filename (docName)
 *      docId      — document UUID
 *      userId     — tenant isolation key
 *
 * 3. RECURSIVE SPLITTING: Same hierarchy as before (paragraph → sentence → word)
 *    with overlap, but now running per-section rather than per-page for tighter
 *    semantic coherence.
 *
 * PARAMETERS:
 * - CHUNK_SIZE:    800 characters
 * - CHUNK_OVERLAP: 150 characters
 */

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;

// ─────────────────────────────────────────────────────────────────────────────
// Section Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if a line looks like a section heading.
 * Matches:  # Heading, ## Heading, 1. Title, 1.2 Title, ALL CAPS (≥4 chars)
 */
function isSectionHeading(line) {
  if (!line || line.trim().length === 0) return false;
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(trimmed)) return true;
  if (trimmed.length >= 4 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) return true;
  return false;
}

/**
 * Extract the heading text (strips markdown # characters and leading numbers).
 */
function extractHeadingText(line) {
  return line.trim().replace(/^#{1,6}\s+/, "").replace(/^\d+(\.\d+)*\.?\s+/, "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive Character Splitter (unchanged logic, used internally)
// ─────────────────────────────────────────────────────────────────────────────

function recursiveSplit(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (text.length <= chunkSize) {
    return [text.trim()].filter((t) => t.length > 0);
  }

  const separators = ["\n\n", "\n", ". ", " "];

  for (const sep of separators) {
    const parts = text.split(sep);
    if (parts.length <= 1) continue;

    const chunks = [];
    let currentChunk = "";

    for (const part of parts) {
      const candidate = currentChunk ? currentChunk + sep + part : part;

      if (candidate.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
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

// ─────────────────────────────────────────────────────────────────────────────
// Section-Aware Segmentation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split page text into { section, text } segments by detecting headings.
 *
 * @param {string} pageText
 * @returns {Array<{section: string, text: string}>}
 */
function splitIntoSections(pageText) {
  const lines = pageText.split("\n");
  const sections = [];
  let currentSection = "Introduction";
  let currentLines = [];

  for (const line of lines) {
    if (isSectionHeading(line)) {
      if (currentLines.join("\n").trim().length > 0) {
        sections.push({ section: currentSection, text: currentLines.join("\n").trim() });
      }
      currentSection = extractHeadingText(line);
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join("\n").trim().length > 0) {
    sections.push({ section: currentSection, text: currentLines.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ section: "Content", text: pageText }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a parsed document into metadata-rich chunks ready for vector storage.
 *
 * Each chunk includes:
 *   id (chunk_id), chunk_text, page, section, docId, docName, userId
 *
 * @param {string} text - Full document text
 * @param {string} docId - Unique document identifier
 * @param {string} docName - Original filename
 * @param {string} userId - User ID for tenant isolation
 * @param {Array<{pageNum: number, text: string}>|null} pages - Page-level splits
 * @returns {Array}
 */
function chunkDocument(text, docId, docName, userId, pages = null) {
  const allChunks = [];
  let chunkIndex = 0;

  const processPage = (pageText, pageNum) => {
    if (!pageText || pageText.trim().length === 0) return;

    const sections = splitIntoSections(pageText);

    for (const { section, text: sectionText } of sections) {
      const textChunks = recursiveSplit(sectionText);
      for (const chunkText of textChunks) {
        if (chunkText.trim().length === 0) continue;
        chunkIndex++;
        allChunks.push({
          id: uuidv4(),
          chunk_text: chunkText,
          page: pageNum,
          section: section || "Content",
          docId,
          docName,
          userId,
          // chunk_id is stored as metadata in Pinecone
          chunk_id: `chunk_${chunkIndex}`,
        });
      }
    }
  };

  if (pages && pages.length > 0) {
    for (const page of pages) {
      processPage(page.text, page.pageNum);
    }
  } else {
    processPage(text, 1);
  }

  const avgLen =
    allChunks.length > 0
      ? Math.round(allChunks.reduce((s, c) => s + c.chunk_text.length, 0) / allChunks.length)
      : 0;

  console.log(
    `Chunked "${docName}" into ${allChunks.length} chunks across ${
      pages?.length || 1
    } page(s) (avg ${avgLen} chars/chunk)`
  );

  return allChunks;
}

export { chunkDocument, recursiveSplit, splitIntoSections, CHUNK_SIZE, CHUNK_OVERLAP };
