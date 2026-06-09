import { Activity, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface CheckResult {
  name: string;
  ok: boolean;
  latency?: number;
  detail?: string;
}

async function checkGemini(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const key = process.env.GOOGLE_GEMINI_API_KEY;
    if (!key) return { name: "Gemini (Google AI)", ok: false, detail: "GOOGLE_GEMINI_API_KEY não configurada" };
    // Usa listagem de modelos — não consome cota de geração
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await res.json()) as { models?: unknown[] };
    const count = data.models?.length ?? 0;
    return {
      name: "Gemini (Google AI)",
      ok: res.ok,
      latency: Date.now() - start,
      detail: res.ok ? `${count} modelo(s) disponível` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { name: "Gemini (Google AI)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkPinecone(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const key = process.env.PINECONE_API_KEY;
    const index = process.env.PINECONE_INDEX;
    if (!key) return { name: "Pinecone (RAG)", ok: false, detail: "PINECONE_API_KEY não configurada" };
    const res = await fetch("https://api.pinecone.io/indexes", {
      headers: { "Api-Key": key },
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as { indexes?: { name: string }[] };
    const found = data.indexes?.some((i) => i.name === index);
    return {
      name: "Pinecone (RAG)",
      ok: res.ok,
      latency: Date.now() - start,
      detail: res.ok ? `Índice "${index}" ${found ? "encontrado" : "não encontrado"}` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { name: "Pinecone (RAG)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkGotenberg(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const url = process.env.GOTENBERG_URL;
    if (!url) return { name: "Gotenberg (PDF)", ok: false, detail: "GOTENBERG_URL não configurada" };
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
    return { name: "Gotenberg (PDF)", ok: res.ok, latency: Date.now() - start, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { name: "Gotenberg (PDF)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkCloudConvert(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const key = process.env.CLOUDCONVERT_API_KEY;
    if (!key) return { name: "CloudConvert (fallback PDF)", ok: false, detail: "Não configurado (apenas fallback)" };
    // JWT com scopes task.read/task.write — usa /tasks em vez de /users/me
    const res = await fetch("https://api.cloudconvert.com/v2/tasks?filter%5Bstatus%5D=finished&per_page=1", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    return {
      name: "CloudConvert (fallback PDF)",
      ok: res.ok,
      latency: Date.now() - start,
      detail: res.ok ? "Autenticado (task.read OK)" : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { name: "CloudConvert (fallback PDF)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkGroq(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) return { name: "Groq (LLM fallback)", ok: false, detail: "GROQ_API_KEY não configurada" };
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as { data?: unknown[] };
    const count = data.data?.length ?? 0;
    return {
      name: "Groq (LLM fallback)",
      ok: res.ok,
      latency: Date.now() - start,
      detail: res.ok ? `${count} modelos disponíveis` : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { name: "Groq (LLM fallback)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkVercelBlob(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return { name: "Vercel Blob (storage)", ok: false, detail: "BLOB_READ_WRITE_TOKEN não configurado" };
    const res = await fetch("https://blob.vercel-storage.com", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    return { name: "Vercel Blob (storage)", ok: res.ok || res.status === 400, latency: Date.now() - start, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { name: "Vercel Blob (storage)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

async function checkFirestore(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const { getAdminDb } = await import("../../../lib/firebase/admin");
    const db = getAdminDb();
    await db.collection("magis_admin_config").doc("singleton").get();
    return { name: "Firestore (Firebase)", ok: true, latency: Date.now() - start, detail: "Leitura OK" };
  } catch (e) {
    return { name: "Firestore (Firebase)", ok: false, latency: Date.now() - start, detail: String(e) };
  }
}

export const dynamic = "force-dynamic";

export default async function SaudePage() {
  const results = await Promise.all([
    checkFirestore(),
    checkGemini(),
    checkGroq(),
    checkPinecone(),
    checkGotenberg(),
    checkCloudConvert(),
    checkVercelBlob(),
  ]);

  const allOk = results.every((r) => r.ok);
  const checked = new Date().toLocaleString("pt-BR");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Admin</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-950">
          <Activity className="h-6 w-6" />
          Saúde das APIs
        </h1>
        <p className="mt-1 text-sm text-slate-500">Verificado em {checked}</p>
      </div>

      {/* Status geral */}
      <div className={`flex items-center gap-3 rounded-2xl border p-5 ${allOk ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        {allOk
          ? <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          : <AlertTriangle className="h-6 w-6 text-rose-600" />}
        <div>
          <p className={`font-semibold ${allOk ? "text-emerald-900" : "text-rose-900"}`}>
            {allOk ? "Todos os serviços operacionais" : "Atenção: um ou mais serviços com problema"}
          </p>
          <p className={`text-sm ${allOk ? "text-emerald-700" : "text-rose-700"}`}>
            {results.filter((r) => r.ok).length} de {results.length} serviços OK
          </p>
        </div>
      </div>

      {/* Cards individuais */}
      <div className="grid gap-4 sm:grid-cols-2">
        {results.map((r) => (
          <div key={r.name} className={`rounded-2xl border p-5 ${r.ok ? "border-slate-200 bg-white" : "border-rose-200 bg-rose-50"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-950">{r.name}</p>
                {r.detail && <p className="mt-0.5 text-xs text-slate-500 truncate">{r.detail}</p>}
                {r.latency !== undefined && (
                  <p className="mt-1 text-xs text-slate-400">{r.latency}ms</p>
                )}
              </div>
              {r.ok
                ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Esta página faz verificações ao vivo a cada carregamento. Use Ctrl+R para atualizar.
      </p>
    </div>
  );
}
