import type { PrismaClient } from "@/generated/prisma";

// TODO(decision): swap to pgvector cosine-similarity search once the KbChunk
// schema moves off its placeholder Json embedding column (see the TODO in
// prisma/schema.prisma) and an embeddings provider is configured. Until
// then, retrieval is keyword-based: split the query into terms and rank
// published chunks by how many terms they contain. It's a real simplification
// (no semantic matching) but keeps the KB → chat → citations flow fully
// working end to end without an extra paid API.
export type RetrievedChunk = {
  articleId: string;
  articleTitle: string;
  content: string;
};

export async function retrieveContext(
  tx: Pick<PrismaClient, "kbChunk">,
  tenantId: string,
  query: string,
  topK = 3
): Promise<RetrievedChunk[]> {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);

  if (terms.length === 0) return [];

  const chunks = await tx.kbChunk.findMany({
    where: {
      tenantId,
      article: { isPublished: true },
      OR: terms.map((term) => ({ content: { contains: term, mode: "insensitive" as const } })),
    },
    include: { article: true },
    take: 50,
  });

  const scored = chunks.map((c) => {
    const lower = c.content.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    return { chunk: c, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk }) => ({
      articleId: chunk.articleId,
      articleTitle: chunk.article.title,
      content: chunk.content,
    }));
}

/** Splits article body into ~500-char chunks on paragraph boundaries (TRD §6.2). */
export function chunkArticleBody(body: string): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > 500 && current) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [body.slice(0, 500)];
}
