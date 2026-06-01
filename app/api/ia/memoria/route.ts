import "server-only";
import { NextResponse } from "next/server";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";
import { updatePedagogicMemory } from "../../../../lib/services/pedagogic-memory.server";

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      conteudo?: Record<string, unknown>;
      metadata?: Record<string, string>;
    };

    void updatePedagogicMemory(
      user.uid,
      body.conteudo ?? {},
      body.metadata ?? {},
    ).catch((e) => console.warn("[api/ia/memoria]", e));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never block the client
  }
}
