/**
 * Seed de roles admin no Firestore.
 *
 * Lê ADMIN_EMAILS e FIREBASE_* do .env.local e seta role="admin"
 * em cada usuário correspondente na coleção magis_users.
 *
 * Uso:
 *   npm run seed:admin
 */

import "dotenv/config";
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
  initAdmin();
  const db = getFirestore();

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    console.error("❌  ADMIN_EMAILS não definido no .env.local");
    process.exit(1);
  }

  console.log(`\nSeed admin — ${adminEmails.length} email(s):\n`);

  for (const email of adminEmails) {
    const snap = await db
      .collection("magis_users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log(`  ⚠️  ${email} — usuário não encontrado (precisa logar uma vez antes)`);
      continue;
    }

    const doc = snap.docs[0];
    await doc.ref.update({ role: "admin" });
    console.log(`  ✅  ${email} — role=admin (uid: ${doc.id})`);
  }

  console.log("\nPronto.\n");
}

run().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
