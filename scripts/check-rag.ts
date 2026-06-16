/**
 * Diagnóstico do RAG: conta vetores no Pinecone por namespace e compara
 * com o total esperado da BNCC (~627 habilidades EF + ~300 EM + ~40 EI).
 *
 * Uso: npx tsx scripts/check-rag.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";

const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "bncc";

// Contagem esperada aproximada por etapa (BNCC oficial)
const EXPECTED: Record<string, number> = {
  EF: 627,   // Ensino Fundamental Anos Iniciais + Finais
  EM: 300,   // Ensino Médio (aprox — varia por área)
  EI: 40,    // Educação Infantil (objetivos de aprendizagem)
};

async function main() {
  if (!PINECONE_API_KEY) {
    console.error("❌ PINECONE_API_KEY não definida");
    process.exit(1);
  }

  console.log(`\n🔍 Consultando index "${PINECONE_INDEX}"...\n`);
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pinecone.index(PINECONE_INDEX);

  // Describeindex para pegar status geral
  const description = await pinecone.describeIndex(PINECONE_INDEX).catch((e) => {
    console.error("Erro ao descrever index:", e);
    return null;
  });
  if (description) {
    console.log(`📦 Index: ${description.name}`);
    console.log(`   Dimensões: ${description.dimension}`);
    console.log(`   Metric:    ${description.metric}`);
    console.log(`   Status:    ${description.status?.state ?? "?"}`);
    console.log();
  }

  // Stats gerais (namespace breakdown)
  const stats = await index.describeIndexStats();
  const total = stats.totalRecordCount ?? 0;
  const namespaces = stats.namespaces ?? {};

  console.log(`📊 Total de vetores: ${total}`);
  console.log();

  const nsNames = Object.keys(namespaces);
  if (nsNames.length === 0) {
    console.log("   (namespace padrão — todos no default)");
    console.log(`   Vetores: ${total}`);
  } else {
    console.log("📂 Por namespace:");
    const defaultNs = total - nsNames.reduce((s, k) => s + (namespaces[k]?.recordCount ?? 0), 0);
    if (defaultNs > 0) {
      console.log(`   [default / BNCC]: ${defaultNs} vetores`);
    }
    for (const [ns, info] of Object.entries(namespaces)) {
      console.log(`   [${ns}]: ${info?.recordCount ?? 0} vetores`);
    }
  }

  // Verificação BNCC: conta por etapa via query rápida usando filtro
  console.log("\n🔎 Amostragem BNCC por etapa (via fetch de IDs conhecidos):");

  // Tenta buscar alguns IDs representativos de cada etapa
  const sampleIds: Record<string, string[]> = {
    EF: ["EF01MA01", "EF01LP01", "EF06CI01", "EF09MA01", "EF09LP01"],
    EM: ["EM13MAT101", "EM13LP01", "EM13CNT101"],
    EI: ["EI03ET01", "EI01CG01"],
  };

  for (const [etapa, ids] of Object.entries(sampleIds)) {
    try {
      const fetched = await index.fetch({ ids });
      const found = Object.keys(fetched.records ?? {}).length;
      const expected = EXPECTED[etapa] ?? "?";
      const status = found === ids.length ? "✅" : found > 0 ? "⚠️ " : "❌";
      console.log(`   ${status} ${etapa}: ${found}/${ids.length} amostras presentes (total esperado: ~${expected})`);
      if (found > 0) {
        const first = Object.values(fetched.records)[0];
        const meta = first?.metadata;
        if (meta) {
          console.log(`      Ex: ${meta["codigo"]} — ${String(meta["texto"]).slice(0, 80)}...`);
        }
      }
    } catch (e) {
      console.log(`   ❌ ${etapa}: erro ao buscar amostras — ${e}`);
    }
  }

  // Resumo
  const bnccDefault = total - Object.values(namespaces).reduce((s, ns) => s + (ns?.recordCount ?? 0), 0);
  const totalEsperado = Object.values(EXPECTED).reduce((a, b) => a + b, 0);

  console.log("\n📋 Resumo:");
  if (bnccDefault >= totalEsperado * 0.9) {
    console.log(`   ✅ BNCC parece completa — ${bnccDefault} vetores (esperado ~${totalEsperado})`);
  } else if (bnccDefault > 0) {
    console.log(`   ⚠️  BNCC incompleta — ${bnccDefault} vetores de ~${totalEsperado} esperados`);
    console.log(`      Rode: npx tsx scripts/ingest-bncc.ts`);
  } else {
    console.log(`   ❌ BNCC vazia ou não ingerida ainda`);
    console.log(`      Rode: npx tsx scripts/ingest-bncc.ts`);
  }

  const otherNamespaces = ["ctbc", "saeb", "curriculo_estadual", "cnct"];
  console.log("\n📂 Outros namespaces:");
  for (const ns of otherNamespaces) {
    const count = namespaces[ns]?.recordCount ?? 0;
    const icon = count > 0 ? "✅" : "❌";
    console.log(`   ${icon} ${ns}: ${count} vetores`);
  }
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
