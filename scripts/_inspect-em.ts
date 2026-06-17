import fs from "fs";
import pdf from "pdf-parse";
async function main() {
  const buf = fs.readFileSync(".cache/BNCC_EnsinoMedio.pdf");
  const { text } = await pdf(buf);
  console.log("Chars:", text.length);
  const sem = text.match(/EM\d{2}[A-Z]{2,3}\d{2,3}/g) ?? [];
  console.log("Códigos sem parênteses:", sem.length, sem.slice(0, 5));
  const com = text.match(/\(EM\d{2}[A-Z]{2,3}\d{2,3}\)/g) ?? [];
  console.log("Códigos COM parênteses:", com.length, com.slice(0, 5));
}
main().catch(console.error);
