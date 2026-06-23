import "server-only";
import { getAdminDb } from "../../firebase/admin";
import type { EscolaRecord, TurmaRecord } from "../../types/firestore";

export async function getUserEscolas(uid: string): Promise<EscolaRecord[]> {
  const db = getAdminDb();
  const snap = await db.collection("magis_escolas").where("user_id", "==", uid).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        user_id: typeof d.user_id === "string" ? d.user_id : "",
        nome: typeof d.nome === "string" ? d.nome : "",
        criado_em: typeof d.criado_em === "string" ? d.criado_em : new Date().toISOString(),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function getUserTurmas(uid: string): Promise<TurmaRecord[]> {
  const db = getAdminDb();
  const snap = await db.collection("magis_turmas").where("user_id", "==", uid).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        user_id: typeof d.user_id === "string" ? d.user_id : "",
        escola_id: typeof d.escola_id === "string" ? d.escola_id : "",
        escola_nome: typeof d.escola_nome === "string" ? d.escola_nome : "",
        nome: typeof d.nome === "string" ? d.nome : "",
        ano_letivo: typeof d.ano_letivo === "number" ? d.ano_letivo : new Date().getFullYear(),
        disciplina: typeof d.disciplina === "string" && d.disciplina ? d.disciplina : undefined,
        criado_em: typeof d.criado_em === "string" ? d.criado_em : new Date().toISOString(),
      };
    })
    .sort(
      (a, b) =>
        a.escola_nome.localeCompare(b.escola_nome, "pt-BR") ||
        a.nome.localeCompare(b.nome, "pt-BR")
    );
}
