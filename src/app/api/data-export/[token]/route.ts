// M21.6 — signed data-export download. The link comes out of the
// build-data-export Inngest job; this route verifies the token, checks
// the row is READY and not expired, and streams the JSON with a
// downloadable filename.

import { NextResponse } from "next/server";
import { withRls } from "@/lib/db";
// B7.5: no cookie R/W here — verifyDataExportToken fully migrates.
import { verifyPurposeToken } from "@/core/auth/tokens";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const payload = await verifyPurposeToken(token, "data-export");
  if (!payload) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  }

  // Runs through withRls so the tenant_isolation policy on
  // data_export_requests passes — the token authenticated the tenant
  // and subject already, so this scope is a formality, not the security
  // check. Row-level tenant+subject filters are still applied as
  // defense in depth.
  const row = await withRls(
    { tenantId: payload.tenantId, userId: payload.subjectId, role: "SUPER_ADMIN" },
    (tx) =>
      tx.dataExportRequest.findFirst({
        where: {
          id: payload.requestId,
          tenantId: payload.tenantId,
          subjectId: payload.subjectId,
        },
      })
  );
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
