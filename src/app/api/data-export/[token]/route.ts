// M21.6 — signed data-export download. The link comes out of the
// build-data-export Inngest job; this route verifies the token, checks
// the row is READY and not expired, and streams the JSON with a
// downloadable filename.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyDataExportToken } from "@/lib/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const payload = await verifyDataExportToken(token);
  if (!payload) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }

  // Not RLS-scoped — the token itself is the auth here. Tenant + subject
  // pinning on the row means a token forged for another subject can't
  // pull this row.
  const row = await prisma.dataExportRequest.findFirst({
    where: {
      id: payload.requestId,
      tenantId: payload.tenantId,
      subjectId: payload.subjectId,
    },
  });
  if (!row || row.status !== "READY" || !row.payload) {
    return NextResponse.json({ error: "This export isn't ready yet." }, { status: 404 });
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired." }, { status: 410 });
  }

  const body = JSON.stringify(row.payload, null, 2);
  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="data-export-${row.id}.json"`,
    },
  });
}
