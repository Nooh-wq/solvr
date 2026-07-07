"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withRls } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { chunkArticleBody } from "@/lib/ai/rag";
import { upsertKbArticleSchema } from "@/lib/validation/kb";

export async function listKbArticles() {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.kbArticle.findMany({ where: { tenantId: session.tenantId }, orderBy: { updatedAt: "desc" } })
  );
}

export async function getKbArticle(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, (tx) =>
    tx.kbArticle.findFirst({ where: { id, tenantId: session.tenantId } })
  );
}

/** Creates/updates an article and re-chunks its body (TRD §6.2 ingest step). */
export async function upsertKbArticle(input: z.infer<typeof upsertKbArticleSchema>) {
  const session = await requireSession({ minRole: "ADMIN" });
  const data = upsertKbArticleSchema.parse(input);
  const chunks = chunkArticleBody(data.body);

  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    const article = data.id
      ? await tx.kbArticle.update({
          where: { id: data.id },
          data: { title: data.title, body: data.body, isPublished: data.isPublished },
        })
      : await tx.kbArticle.create({
          data: { tenantId: session.tenantId, title: data.title, body: data.body, isPublished: data.isPublished },
        });

    await tx.kbChunk.deleteMany({ where: { articleId: article.id } });
    await tx.kbChunk.createMany({
      data: chunks.map((content) => ({ tenantId: session.tenantId, articleId: article.id, content })),
    });

    revalidatePath("/admin/kb");
    return { ok: true, article };
  });
}

export async function deleteKbArticle(id: string) {
  const session = await requireSession({ minRole: "ADMIN" });
  return withRls({ tenantId: session.tenantId, userId: session.subjectId, role: session.role }, async (tx) => {
    await tx.kbArticle.deleteMany({ where: { id, tenantId: session.tenantId } });
    revalidatePath("/admin/kb");
    return { ok: true };
  });
}
