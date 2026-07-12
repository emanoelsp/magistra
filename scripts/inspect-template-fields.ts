/**
 * Diagnóstico read-only: imprime schema_campos (key, label, role, classe,
 * defaultValue) e metadata_padrao de um template.
 *
 * Uso: npx tsx --env-file=.env.local scripts/inspect-template-fields.ts <templateId>
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

async function run() {
  const templateId = process.argv[2];
  if (!templateId) {
    console.error("Uso: npx tsx scripts/inspect-template-fields.ts <templateId>");
    process.exit(1);
  }
  initAdmin();
  const db = getFirestore();
  const snap = await db.collection("magis_templates").doc(templateId).get();
  if (!snap.exists) {
    console.error("Template não encontrado:", templateId);
    process.exit(1);
  }
  const d = snap.data()!;
  console.log("nome:", d.nome);
  console.log("createTime:", snap.createTime?.toDate().toISOString());
  console.log("updateTime:", snap.updateTime?.toDate().toISOString());
  console.log("metadata_padrao:", JSON.stringify(d.metadata_padrao ?? null, null, 2));
  console.log("\nschema_campos:");
  for (const f of (d.schema_campos ?? []) as Array<Record<string, unknown>>) {
    console.log(
      `  ${String(f.key).padEnd(45)} role=${String(f.role ?? "-").padEnd(12)} classe=${String(f.classe ?? "-").padEnd(12)} group=${String(f.group ?? "-").padEnd(14)} defaultValue=${JSON.stringify(f.defaultValue ?? null)}`,
    );
  }
}

void run();
