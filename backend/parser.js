import fs from "fs/promises";
import path from "path";

/**
 * Parse a document file and extract text content.
 * Supports PDF and plain text files.
 *
 * @param {Buffer} fileBuffer - The file contents as a buffer
 * @param {string} originalName - Original filename (used for type detection)
 * @returns {Promise<{text: string, pages: Array<{pageNum: number, text: string}>}>}
 */
async function parseDocument(fileBuffer, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    return parsePDF(fileBuffer);
  } else if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    return parsePlainText(fileBuffer);
  } else {
    throw new Error(
      `Unsupported file type: ${ext}. Supported types: .pdf, .txt, .md, .csv, .json, .log`
    );
  }
}

/**
 * Parse a PDF file and extract text page by page.
 */
async function parsePDF(fileBuffer) {
  // pdf-parse is a CJS module, use dynamic import
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(fileBuffer);

  // pdf-parse gives us the full text + page count
  // We'll split by form-feed characters or estimate page splits
  const fullText = data.text;
  const numPages = data.numpages;

  // pdf-parse doesn't give per-page text directly via the simple API,
  // but we can use the render callback to get page-by-page text
  const pages = [];

  // Re-parse with page-level render
  const pageTexts = [];
  await pdfParse(fileBuffer, {
    pagerender: async function (pageData) {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");
      pageTexts.push(text);
      return text;
    },
  });

  for (let i = 0; i < pageTexts.length; i++) {
    pages.push({
      pageNum: i + 1,
      text: pageTexts[i],
    });
  }

  console.log(
    `Parsed PDF: ${numPages} pages, ${fullText.length} total characters.`
  );

  return { text: fullText, pages };
}

/**
 * Parse a plain text file.
 */
async function parsePlainText(fileBuffer) {
  const text = fileBuffer.toString("utf-8");

  return {
    text,
    pages: [{ pageNum: 1, text }],
  };
}

export { parseDocument };
