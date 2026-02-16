/**
 * Document chunking utilities for RAG ingestion.
 *
 * Splits large documents into overlapping chunks suitable
 * for vector embedding and retrieval.
 */

export interface DocumentChunk {
  key: string;
  content: string;
  title: string;
  filename: string;
  category: string;
  chunkIndex: number;
}

/**
 * Split a document into chunks with overlap.
 * @param text - Full document text
 * @param filename - Original filename
 * @param title - Document title
 * @param category - Document category
 * @param chunkSize - Max chars per chunk (default: 1000)
 * @param overlap - Overlap between chunks (default: 200)
 */
export function chunkDocument(
  text: string,
  filename: string,
  title: string,
  category: string = "general",
  chunkSize: number = 1000,
  overlap: number = 200
): DocumentChunk[] {
  const cleanText = text.replace(/\r\n/g, "\n").trim();
  if (!cleanText) return [];

  // If text fits in one chunk, return as-is
  if (cleanText.length <= chunkSize) {
    return [
      {
        key: `${filename}-0`,
        content: cleanText,
        title,
        filename,
        category,
        chunkIndex: 0,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let chunkIdx = 0;

  while (start < cleanText.length) {
    let end = start + chunkSize;

    // Try to break at a paragraph or sentence boundary
    if (end < cleanText.length) {
      const paragraphBreak = cleanText.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + chunkSize * 0.5) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = cleanText.lastIndexOf(". ", end);
        if (sentenceBreak > start + chunkSize * 0.5) {
          end = sentenceBreak + 1;
        }
      }
    }

    const content = cleanText.slice(start, end).trim();
    if (content) {
      chunks.push({
        key: `${filename}-${chunkIdx}`,
        content,
        title,
        filename,
        category,
        chunkIndex: chunkIdx,
      });
      chunkIdx++;
    }

    start = end - overlap;
    if (start >= cleanText.length) break;
  }

  return chunks;
}
