import { getAdminDb } from "../../../lib/firebase/admin";
import { Inbox } from "lucide-react";
import { MensagensClient, type AdminMensagem } from "./mensagens-client";

async function getMensagens(): Promise<AdminMensagem[]> {
  const db = getAdminDb();

  const [contactSnap, suporteSnap] = await Promise.all([
    db.collection("magis_messages").orderBy("created_at", "desc").limit(100).get(),
    db.collection("magis_suporte").orderBy("criado_em", "desc").limit(100).get(),
  ]);

  const contatos: AdminMensagem[] = contactSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      origem: "contato" as const,
      tipo: (d.tipo as string) ?? "contato",
      nome: (d.nome as string) ?? "—",
      email: (d.email as string) ?? "—",
      assunto: (d.assunto as string) ?? "—",
      mensagem: (d.mensagem as string) ?? "",
      status: (d.status as string) ?? "aberto",
      created_at: (d.created_at as string) ?? "",
      resposta: d.resposta as string | undefined,
    };
  });

  const tickets: AdminMensagem[] = suporteSnap.docs.map((doc) => {
    const d = doc.data();
    const raw = d.criado_em;
    const dt: string = raw && typeof raw.toDate === "function"
      ? (raw.toDate() as Date).toISOString()
      : String(raw ?? "");
    return {
      id: doc.id,
      origem: "suporte" as const,
      tipo: (d.categoria as string) ?? "suporte",
      nome: (d.nome as string) ?? "—",
      email: (d.email as string) ?? "—",
      assunto: (d.assunto as string) ?? "—",
      mensagem: (d.mensagem as string) ?? "",
      status: (d.status as string) ?? "aberto",
      created_at: dt,
      prioridade: d.prioridade as string | undefined,
    };
  });

  return [...contatos, ...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export default async function MensagensPage() {
  const mensagens = await getMensagens();
  const abertas = mensagens.filter((m) => m.status === "aberto" || m.status === "em_andamento" || m.status === "em_atendimento").length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-950">
          <Inbox className="h-6 w-6" />
          Mensagens & Suporte
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {mensagens.length} mensagens · {abertas} abertas
        </p>
      </div>

      <MensagensClient mensagens={mensagens} />
    </div>
  );
}
