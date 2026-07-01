import "server-only";
import { NextResponse } from "next/server";
import { getAdminDb } from "../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../lib/auth/session";

// Feedback implícito de qualidade do RAG: capturado no save, não interrompe o professor.
interface FeedbackEntry {
  fieldKey: string;
  sugestaoId: string;
  namespace: string;   // resolvido server-side no /api/ia/campo — "bncc" | "saeb" | "curriculo_estadual" | "cnct" | "curriculo_digital" | "unknown"
  outcome: "accepted" | "expanded" | "replaced";
  injectedLen: number;
  finalLen: number;
  msSinceInject: number;
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUserProfile();
    const body = (await request.json()) as {
      templateId?: string;
      fieldKey?: string;
      sugestaoId?: string;
      tipo?: "titulo" | "completo";
      feedback?: FeedbackEntry[];
    };

    const { templateId, fieldKey, sugestaoId, tipo, feedback } = body;

    const db = getAdminDb();
    const batch = db.batch();

    // ── Caminho 1: evento de aceitação imediata (legado — mantido) ────────────
    if (templateId && fieldKey && sugestaoId) {
      const ref = db.collection("magis_usage_logs").doc();
      batch.set(ref, {
        user_id: user.uid,
        action: "sugestao_aceita",
        template_id: templateId,
        field_key: fieldKey,
        sugestao_id: sugestaoId,
        tipo: tipo ?? "completo",
        timestamp: new Date().toISOString(),
      });
    }

    // ── Caminho 2: feedback implícito de qualidade (batch no save) ────────────
    if (templateId && Array.isArray(feedback) && feedback.length > 0) {
      for (const entry of feedback.slice(0, 20)) { // teto: 20 campos por save
        if (!entry.fieldKey || !entry.outcome) continue;
        const ref = db.collection("magis_rag_feedback").doc();
        batch.set(ref, {
          user_id:           user.uid,
          template_id:       templateId,
          field_key:         entry.fieldKey,
          sugestao_id:       entry.sugestaoId,
          namespace:         entry.namespace ?? "unknown",
          outcome:           entry.outcome,          // "accepted" | "expanded" | "replaced"
          injected_len:      entry.injectedLen,
          final_len:         entry.finalLen,
          ms_since_inject:   entry.msSinceInject,
          timestamp:         new Date().toISOString(),
        });
      }
    }

    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // nunca falha o cliente em telemetria
  }
}
