import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pinecone } from "@pinecone-database/pinecone";

async function main() {
  const ns = process.argv[2];
  if (!ns) throw new Error("Uso: npx tsx scripts/clean-namespace.ts <namespace>");
  const pc = new Pinecone({ apiKey: process.env["PINECONE_API_KEY"]! });
  await pc.index(process.env["PINECONE_INDEX"] ?? "bncc").namespace(ns).deleteAll();
  console.log(`✅ namespace "${ns}" limpo`);
}
main().catch((e) => { console.error(e); process.exit(1); });
