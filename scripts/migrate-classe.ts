/**
 * Migração: backfill do campo `classe` em todos os schema_campos de magis_templates.
 *
 * Para cada template, percorre schema_campos e adiciona `classe` onde está ausente,
 * usando inferirClasse(key, role) — mesma lógica do servidor/cliente.
 *
 * Uso:
 *   npx tsx scripts/migrate-classe.ts [--dry-run]
 *
 * Seguro para rodar múltiplas vezes (idempotente — só preenche campos ausentes).
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Inline inferirClasse to avoid TS path issues in scripts
type Classe = "perfil" | "pedagogico" | "contextual";
type Role   = "manual" | "ia_sugerida";

const CONTEXTUAL = [
  /^(ctx[_.]|mes[_.]|mes$|data[_.]|data_atual|data_geracao|data_realizacao|data_inicio|data_fim)/i,
  /^(bimestre|trimestre|semestre|periodo[_.]|periodo$)/i,
  /^(ano_letivo|ano_atual|ano$)/i,
];
const PERFIL = [
  /^(professor|docente|regente|ministrante|formador|orientador)[_.]?/i,
  /^(escola|unidade_escolar|colegio|instituicao)[_.]?/i,
  /^(turma|serie|ano_serie|classe)[_.]?/i,
  /^(area_componente|componente|disciplina|materia)[_.]?/i,
  /^(cargo|funcao|coordenador|diretor)[_.]?/i,
  /^(municipio|cidade|estado|uf)[_.]?/i,
];
const PEDAGOGICO = [
  /^(bncc|saeb|habilidade|competencia|conteudo|objetivo|metodologia|avaliacao|recurso)[_.]?/i,
  /^(ped[_.]|pedagogico)[_.]?/i,
  /^(expectativa|recuperacao|atividade|estrategia)[_.]?/i,
  /^(tematica|tema|projeto|objeto_conhecimento|unidade_tematica)[_.]?/i,
];

function inferirClasse(key: string, role?: string): Classe {
  if (role === "ia_sugerida") return "pedagogico";
  for (const re of CONTEXTUAL) if (re.test(key)) return "contextual";
  for (const re of PEDAGOGICO) if (re.test(key)) return "pedagogico";
  for (const re of PERFIL)     if (re.test(key)) return "perfil";
  return "perfil";
}

function initAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID   ?? process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
    }),
  });
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("⚠️  Modo dry-run: nenhuma escrita será feita.\n");

  initAdmin();
  const db = getFirestore();

  const snap = await db.collection("magis_templates").get();
  console.log(`Templates encontrados: ${snap.size}`);

  let totalUpdated = 0;
  let totalFieldsPatched = 0;

  const BATCH_SIZE = 400;
  let batch = db.batch();
  let batchCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const schema = data.schema_campos;
    if (!Array.isArray(schema) || schema.length === 0) continue;

    let dirty = false;
    const newSchema = schema.map((f: Record<string, unknown>) => {
      if (f.classe) return f; // already set — skip
      const key  = typeof f.key  === "string" ? f.key  : "";
      const role = typeof f.role === "string" ? f.role : undefined;
      const classe = inferirClasse(key, role);
      dirty = true;
      totalFieldsPatched++;
      return { ...f, classe };
    });

    if (!dirty) continue;

    totalUpdated++;
    console.log(`  ${doc.id} (${doc.data().nome ?? "?"}): ${newSchema.filter((f: Record<string, unknown>) => f.classe).length} campos com classe`);

    if (!dryRun) {
      batch.update(doc.ref, { schema_campos: newSchema });
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        console.log("  [batch commit]");
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (!dryRun && batchCount > 0) {
    await batch.commit();
    console.log("  [batch commit final]");
  }

  console.log(`\nResumo:`);
  console.log(`  Templates atualizados: ${totalUpdated}`);
  console.log(`  Campos com 'classe' preenchido: ${totalFieldsPatched}`);
  if (dryRun) console.log("  (dry-run: nenhuma alteração gravada)");
}

run().catch((err) => { console.error(err); process.exit(1); });
