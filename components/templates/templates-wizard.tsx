"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, Plus, Sparkles, X } from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";
import type { EscolaRecord } from "../../lib/types/firestore";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplatesWizardProps {
  userId: string;
  escolas: EscolaRecord[];
  hasTemplates?: boolean;
  canAssociateEscola?: boolean;
}

// ---------------------------------------------------------------------------
// Magis modal shell (local copy — not exported from escolas-manager)
// ---------------------------------------------------------------------------

function MagisModal({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-[10vh] backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <style>{`@keyframes magis-pop { from { opacity:0;transform:scale(.85) translateY(24px)} to { opacity:1;transform:scale(1) translateY(0)} }`}</style>
      <div
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-3xl shadow-2xl max-h-[80vh]"
        style={{ animation: "magis-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {children}
      </div>
    </div>
  );
}

function MagisHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-violet-700 px-5 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Sparkles className="h-4 w-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white leading-tight">Magis</p>
        <p className="text-[11px] text-violet-300">assistente de planos</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MagisBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-sm mb-0.5">
        <Sparkles className="h-3 w-3 text-white" />
      </div>
      <div className="max-w-[82%]">
        <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-snug text-slate-800">{text}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

type Step = "docx" | "escola" | "nome" | "arquivo";

export function TemplatesWizard({ userId, escolas, hasTemplates = false, canAssociateEscola = true }: TemplatesWizardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("docx");
  const [escolaNome, setEscolaNome] = useState("");
  const [selectedEscolaId, setSelectedEscolaId] = useState<string>("");
  const [nomeTemplate, setNomeTemplate] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileType = pendingFile
    ? (pendingFile.name.split(".").pop()?.toLowerCase() === "pdf" ? "pdf" : "docx")
    : null;

  function handleClose() {
    setOpen(false);
    setStep("docx");
    setEscolaNome("");
    setSelectedEscolaId("");
    setNomeTemplate("");
    setPendingFile(null);
    setError(null);
  }

  function selectFile(file: File) {
    setPendingFile(file);
    setError(null);
  }

  function clearFile() {
    setPendingFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) selectFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) selectFile(file);
  }

  function handleEscolaPular() {
    setEscolaNome("");
    setSelectedEscolaId("");
    setStep("nome");
  }

  function handleEscolaConfirm() {
    if (selectedEscolaId) {
      const found = escolas.find((e) => e.id === selectedEscolaId);
      setEscolaNome(found?.nome ?? "");
    }
    setStep("nome");
  }

  async function handleUpload() {
    if (!pendingFile) return;
    if (!nomeTemplate.trim()) {
      setError("Informe o nome do template.");
      return;
    }
    setError(null);
    setIsUploading(true);
    try {
      const file = pendingFile;
      const templateId = await templatesService.createTemplate({
        user_id: userId,
        nome: nomeTemplate.trim(),
        escola_nome: escolaNome || undefined,
        schema_campos: [],
      });

      const formData = new FormData();
      formData.append("templateId", templateId);
      formData.append("file", file);

      const uploadFormData = new FormData();
      uploadFormData.append("templateId", templateId);
      uploadFormData.append("file", file);

      const [introspectRes] = await Promise.all([
        fetch("/api/templates/introspect", { method: "POST", body: formData }),
        fetch("/api/templates/upload-arquivo", { method: "POST", body: uploadFormData }),
      ]);

      const introspectData = (await introspectRes.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!introspectRes.ok) {
        throw new Error(introspectData?.error ?? "Falha ao extrair campos do arquivo.");
      }

      router.push(`/dashboard/templates/${templateId}/confirmar`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o template.");
      setIsUploading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger area (when modal is closed)
  // ---------------------------------------------------------------------------

  if (!open) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-3 max-w-2xl">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-md">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 rounded-2xl rounded-tl-none border border-violet-100 bg-violet-50 p-4 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-violet-600" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Magis</span>
            </div>
            {hasTemplates ? (
              <p className="text-sm leading-relaxed text-slate-800">
                Legal! Vejo que você já tem templates cadastrados. Se quiser cadastrar mais, é só clicar no botão abaixo.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-slate-800">
                Para criar planos, preciso conhecer o modelo da sua escola. Suba o arquivo <strong>.docx</strong> e eu identifico os campos automaticamente!
              </p>
            )}
          </div>
        </div>
        <div className="flex w-full justify-center">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-500"
          >
            <FileText className="h-4 w-4" />
            {hasTemplates ? "Adicionar novo template" : "Criar meu primeiro template"}
            <span>→</span>
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Step: docx tip
  // ---------------------------------------------------------------------------

  if (step === "docx") {
    return (
      <MagisModal>
        <MagisHeader onClose={handleClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-3">
          <MagisBubble text="Para reconhecer o template com 100% de fidelidade, use o arquivo .docx em branco — sem conteúdo preenchido, só a estrutura da escola." />
          <div className="ml-9 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Arquivo em branco</p>
              <p className="mt-0.5 text-xs leading-snug text-amber-800">
                Sem dados preenchidos — apenas o formulário/<br />estrutura da escola. Pode apagar os exemplos antes de subir.
              </p>
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={() => setStep(canAssociateEscola ? "escola" : "nome")}
            className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Entendi, vamos lá! →
          </button>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Step: escola selection
  // ---------------------------------------------------------------------------

  if (step === "escola") {
    return (
      <MagisModal>
        <MagisHeader onClose={handleClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          {escolas.length > 0 ? (
            <MagisBubble text="Vi que você tem escolas cadastradas! Deseja associar este template a uma delas?" />
          ) : (
            <MagisBubble text="Você ainda não tem escola cadastrada. Pode pular essa etapa e associar depois." />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 bg-white">
          {escolas.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 space-y-1.5 pr-4">
              {escolas.map((escola) => (
                <label
                  key={escola.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-2.5 cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="escola"
                    value={escola.id}
                    checked={selectedEscolaId === escola.id}
                    onChange={() => setSelectedEscolaId(escola.id)}
                    className="h-4 w-4 accent-violet-600"
                  />
                  <span className="text-sm font-medium text-slate-800">{escola.nome}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex shrink-0 gap-2 px-5 py-4">
            <button
              type="button"
              onClick={handleEscolaPular}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Pular por agora
            </button>
            {escolas.length > 0 && (
              <button
                type="button"
                onClick={handleEscolaConfirm}
                disabled={!selectedEscolaId}
                className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Confirmar →
              </button>
            )}
          </div>
        </div>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Step: nome
  // ---------------------------------------------------------------------------

  if (step === "nome") {
    return (
      <MagisModal>
        <MagisHeader onClose={handleClose} />
        <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
          <MagisBubble text="Preciso de um nome para identificar este template. Como você quer chamá-lo?" />
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); if (nomeTemplate.trim()) setStep("arquivo"); }}
          className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3"
        >
          <textarea
            value={nomeTemplate}
            onChange={(e) => setNomeTemplate(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            rows={1}
            placeholder="Ex: Plano de aula semanal"
            autoFocus
            className="w-full resize-none overflow-hidden rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-950"
            style={{ minHeight: "48px" }}
          />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setStep("escola")}
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={!nomeTemplate.trim()}
              className="flex-1 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Próximo →
            </button>
          </div>
        </form>
      </MagisModal>
    );
  }

  // ---------------------------------------------------------------------------
  // Step: arquivo
  // ---------------------------------------------------------------------------

  return (
    <MagisModal>
      <MagisHeader onClose={handleClose} />

      {/* Loading overlay inside modal */}
      {isUploading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-3xl bg-white/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-100 border-t-violet-600" />
            <Sparkles className="absolute h-4 w-4 text-violet-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900">Magis está analisando seu template…</p>
            <p className="mt-0.5 text-xs text-slate-500">Isso pode levar alguns segundos.</p>
          </div>
        </div>
      )}

      <div className="bg-[#ece5dd] px-4 py-5 space-y-2">
        <MagisBubble text="Agora carregue o template da sua escola — o arquivo .docx em branco." />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 space-y-3">
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        )}

        {!pendingFile ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-8 transition ${
              dragOver
                ? "border-violet-400 bg-violet-50"
                : "border-slate-300 bg-slate-50 hover:border-slate-400"
            }`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <CloudUpload className="h-5 w-5" />
            </span>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Arraste ou clique para selecionar</p>
              <div className="mt-1.5 flex items-center justify-center gap-3">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  .docx — recomendado
                </span>
                <span className="text-xs text-slate-400">.pdf — aceito</span>
              </div>
              <p className="mt-2 text-[11px] font-medium text-amber-600">⚠ Em branco — sem dados preenchidos</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.doc,.pdf"
              className="hidden"
              onChange={onFileChange}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{pendingFile.name}</p>
              <p className="text-xs text-slate-400">
                {(pendingFile.size / 1024).toFixed(0)} KB · {fileType?.toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Remover arquivo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setStep("nome")}
            className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Voltar
          </button>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={!pendingFile || isUploading}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="h-4 w-4" />
            Analisar com a Magis
          </button>
        </div>
      </div>
    </MagisModal>
  );
}
