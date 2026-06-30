/**
 * Analisa feedback implícito de qualidade do RAG coletado em produção.
 *
 * Lê a coleção `rag_feedback` do Firestore e produz métricas de precisão
 * por namespace, por tipo de campo e por fonte curriclar.
 *
 * Uso:
 *   npx tsx scripts/analyze-rag-precision.ts
 *   npx tsx scripts/analyze-rag-precision.ts --days 30
 *   npx tsx scripts/analyze-rag-precision.ts --namespace bncc
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getAdminDb } from "../lib/firebase/admin";

const DAYS = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "90");
const NS_FILTER = process.argv.find((a) => a.startsWith("--namespace="))?.split("=")[1];

interface FeedbackDoc {
  user_id: string;
  template_id: string;
  field_key: string;
  sugestao_id: string;
  fonte: string;
  namespace: string;
  outcome: "accepted" | "expanded" | "replaced";
  injected_len: number;
  final_len: number;
  ms_since_inject: number;
  timestamp: string;
}

interface NamespaceStats {
  total: number;
  accepted: number;
  expanded: number;
  replaced: number;
  acceptRate: number;     // accepted / total
  retentionRate: number;  // (accepted + expanded) / total
  avgMsToSave: number;
}

async function main() {
  const db = getAdminDb();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  let query = db.collection("rag_feedback")
    .where("timestamp", ">=", since)
    .orderBy("timestamp", "desc") as FirebaseFirestore.Query;

  if (NS_FILTER) query = query.where("namespace", "==", NS_FILTER);

  const snap = await query.limit(5000).get();

  if (snap.empty) {
    console.log(`\n📭 Nenhum feedback registrado nos últimos ${DAYS} dias.`);
    console.log("   Gere planos e salve para começar a coletar dados.\n");
    return;
  }

  const docs = snap.docs.map((d) => d.data() as FeedbackDoc);
  console.log(`\n📊 RAG Precision Audit — últimos ${DAYS} dias (n=${docs.length})\n`);

  // ── Por namespace ─────────────────────────────────────────────────────────
  const byNs: Record<string, NamespaceStats> = {};
  for (const d of docs) {
    const ns = d.namespace || "unknown";
    if (!byNs[ns]) byNs[ns] = { total: 0, accepted: 0, expanded: 0, replaced: 0, acceptRate: 0, retentionRate: 0, avgMsToSave: 0 };
    const s = byNs[ns]!;
    s.total++;
    s[d.outcome]++;
    s.avgMsToSave += d.ms_since_inject ?? 0;
  }

  const nsOrder = ["bncc", "saeb", "curriculo_estadual", "cnct", "curriculo_digital", "unknown"];
  console.log("📂 Precisão por namespace (% de sugestões aceitas ou expandidas):\n");
  console.log("  Namespace              Total  Aceitas  Expandidas  Trocadas  Accept%  Retenção%  AvgSave");
  console.log("  " + "─".repeat(90));

  for (const ns of nsOrder) {
    const s = byNs[ns];
    if (!s) continue;
    s.acceptRate    = s.accepted / s.total;
    s.retentionRate = (s.accepted + s.expanded) / s.total;
    s.avgMsToSave   = Math.round(s.avgMsToSave / s.total / 1000);
    const bar = "█".repeat(Math.round(s.retentionRate * 10)) + "░".repeat(10 - Math.round(s.retentionRate * 10));
    const icon = s.retentionRate >= 0.7 ? "✅" : s.retentionRate >= 0.4 ? "⚠️ " : "❌";
    console.log(
      `  ${icon} ${ns.padEnd(22)} ${String(s.total).padStart(5)}  ${String(s.accepted).padStart(7)}  ${String(s.expanded).padStart(10)}  ${String(s.replaced).padStart(8)}  ${(s.acceptRate * 100).toFixed(0).padStart(6)}%  ${(s.retentionRate * 100).toFixed(0).padStart(8)}%  ${String(s.avgMsToSave).padStart(5)}s  ${bar}`,
    );
  }

  // ── Por group de campo ────────────────────────────────────────────────────
  console.log("\n🏷️  Precisão por grupo de campo:\n");
  const inferGroup = (fieldKey: string) => {
    const k = fieldKey.toLowerCase();
    if (/objetiv/.test(k)) return "objetivos";
    if (/habilid/.test(k)) return "habilidades";
    if (/compet/.test(k)) return "competencias";
    if (/conteud|programat/.test(k)) return "conteudos";
    if (/avaliac/.test(k)) return "avaliacao";
    if (/metodol|estrateg/.test(k)) return "metodologia";
    return "outros";
  };

  const byGroup: Record<string, { total: number; retained: number }> = {};
  for (const d of docs) {
    const g = inferGroup(d.field_key);
    if (!byGroup[g]) byGroup[g] = { total: 0, retained: 0 };
    byGroup[g]!.total++;
    if (d.outcome !== "replaced") byGroup[g]!.retained++;
  }
  for (const [g, s] of Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total)) {
    const pct = (s.retained / s.total * 100).toFixed(0);
    const icon = Number(pct) >= 70 ? "✅" : Number(pct) >= 40 ? "⚠️ " : "❌";
    console.log(`  ${icon} ${g.padEnd(15)} ${String(s.total).padStart(5)} eventos  retenção: ${pct}%`);
  }

  // ── Fontes com maior taxa de rejeição ─────────────────────────────────────
  const byFonte: Record<string, { total: number; replaced: number }> = {};
  for (const d of docs) {
    const f = d.fonte || "sem fonte";
    if (!byFonte[f]) byFonte[f] = { total: 0, replaced: 0 };
    byFonte[f]!.total++;
    if (d.outcome === "replaced") byFonte[f]!.replaced++;
  }
  const worstFontes = Object.entries(byFonte)
    .filter(([, s]) => s.total >= 3)
    .map(([f, s]) => ({ f, ...s, rate: s.replaced / s.total }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  if (worstFontes.length > 0) {
    console.log("\n⚠️  Fontes com maior taxa de rejeição (n ≥ 3):\n");
    for (const { f, total, replaced, rate } of worstFontes) {
      console.log(`   ${(rate * 100).toFixed(0).padStart(3)}% trocadas — "${f}" (${replaced}/${total})`);
    }
  }

  // ── Resumo executivo ──────────────────────────────────────────────────────
  const globalAccepted = docs.filter((d) => d.outcome === "accepted").length;
  const globalRetained = docs.filter((d) => d.outcome !== "replaced").length;
  console.log(`\n📋 Resumo global:`);
  console.log(`   Accept rate:   ${(globalAccepted / docs.length * 100).toFixed(1)}% (${globalAccepted}/${docs.length})`);
  console.log(`   Retention rate: ${(globalRetained / docs.length * 100).toFixed(1)}% (accepted + expanded)`);
  console.log(`\n   Interpretação:`);
  console.log(`   • >70% retenção → RAG cirúrgico para esse namespace`);
  console.log(`   • 40–70%        → relevante mas pode melhorar thresholds ou query`);
  console.log(`   • <40%          → baixa precisão — revisar chunks ou limiar de score\n`);
}

main().catch((err) => { console.error("❌", err); process.exit(1); });
