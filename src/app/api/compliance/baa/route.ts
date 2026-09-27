// M20.7 — BAA download endpoint. Admin-only; requires HIPAA mode.

import { NextResponse } from "next/server";
import { generateBaaText } from "@/actions/compliance";

export async function GET() {
  try {
    const text = await generateBaaText();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="baa.txt"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 403 }
    );
  }
}
