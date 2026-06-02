/**
 * Migração: adiciona role="professor" e data_criacao a todos os usuários
 * da coleção magis_users que ainda não possuem esses campos.
 *
 * Uso:
 *   npm run migrate:users
 *
 * Seguro para rodar múltiplas vezes (idempotente — só preenche campos ausentes).
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
  initAdmin();
  const db = getFirestore();

  const snap = await db.collection("magis_users").get();
  console.log(`\nMigrando ${snap.size} usuário(s)...\n`);

  let updated = 0;
  let skipped = 0;

  // Processa em lotes de 500 (limite do Firestore batch)
  const BATCH_SIZE = 500;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);

    for (const doc of chunk) {
      const data = doc.data();
      const needsUpdate = !data.role || !data.data_criacao;

      if (!needsUpdate) {
        skipped++;
        continue;
      }

      const update: Record<string, unknown> = {};

      if (!data.role) {
        update.role = "professor";
      }

      if (!data.data_criacao) {
        // Usa a data de criação do documento Firestore se disponível, senão agora
        const createdAt = doc.createTime?.toDate?.()?.toISOString() ?? new Date().toISOString();
        update.data_criacao = createdAt;
      }

      batch.update(doc.ref, update);
      updated++;

      const email = data.email ?? doc.id;
      console.log(`  ✅  ${email} — ${Object.keys(update).join(", ")}`);
    }

    if (updated > 0) await batch.commit();
  }

  console.log(`\nConcluído: ${updated} atualizado(s), ${skipped} já estavam corretos.\n`);
}

run().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
