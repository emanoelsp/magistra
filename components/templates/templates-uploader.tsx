"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CloudUpload, FileText, Sparkles, X } from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";

interface TemplatesUploaderProps {
  userId: string;
}

export function TemplatesUploader({ userId }: TemplatesUploaderProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escolaNome, setEscolaNome] = useState("");
  const [nomeTemplate, setNomeTemplate] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileType = pendingFile
    ? (pendingFile.name.split(".").pop()?.toLowerCase() === "pdf" ? "pdf" : "docx")
    : null;

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
    e.target.value = ""; // reset so same file can be re-selected
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) selectFile(file);
  }

  async function handleUpload() {
    if (!pendingFile) return;

    if (!escolaNome.trim() || !nomeTemplate.trim()) {
      setError("Preencha o nome da escola e o nome do template antes de enviar.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const file = pendingFile;

      const templateId = await templatesService.createTemplate({
        user_id: userId,
        nome: nomeTemplate.trim(),
        escola_nome: escolaNome,
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
        schema?: unknown;
      } | null;

      if (!introspectRes.ok) {
        throw new Error(introspectData?.error ?? "Falha ao extrair campos do arquivo.");
      }

      router.push(`/dashboard/templates/${templateId}/confirmar`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o template.");
    } finally {
      setIsUploading(false);
    }
  }

  const canUpload = !!pendingFile && !!escolaNome.trim() && !!nomeTemplate.trim();

  return (
    <div className="relative rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6">

      {/* Loading overlay */}
      {isUploading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-3xl bg-white/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-100 border-t-violet-600" />
            <Sparkles className="absolute h-4 w-4 text-violet-600" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900">Magis está lendo seu template…</p>
            <p className="mt-0.5 text-xs text-slate-500">A Magis está mapeando os campos do seu documento.</p>
          </div>
        </div>
      )}

      <div className="space-y-5">

        {/* DOCX tip */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-semibold text-emerald-800">
            Use <strong>.docx</strong> para 100% de fidelidade —
            <span className="ml-1 font-normal text-emerald-700">
              logo, tabelas, cores e fontes preservados exatamente.
            </span>
          </p>
        </div>

        {/* Campos: escola + tipo */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Nome da escola
            </label>
            <input
              type="text"
              value={escolaNome}
              onChange={(e) => { setEscolaNome(e.target.value); setError(null); }}
              placeholder="Ex.: E. M. João XXIII"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Nome do template
            </label>
            <input
              type="text"
              value={nomeTemplate}
              onChange={(e) => { setNomeTemplate(e.target.value); setError(null); }}
              placeholder="Ex.: Plano de aula semanal"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-950"
            />
          </div>
        </div>

        {/* Drop zone — hidden when file is already selected */}
        {!pendingFile ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-8 transition ${
              dragOver
                ? "border-violet-400 bg-violet-50"
                : "border-slate-300 bg-white hover:border-slate-400"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <CloudUpload className="h-5 w-5" />
            </span>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">
                Arraste o arquivo ou clique para selecionar
              </p>
              <div className="mt-1.5 flex items-center justify-center gap-3">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  .docx — recomendado
                </span>
                <span className="text-xs text-slate-400">.pdf — aceito</span>
              </div>
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
          /* Selected file card + send button */
          <div className="space-y-3">
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

            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!canUpload || isUploading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Analisar template com a Magis
            </button>
          </div>
        )}

        {/* PDF warning */}
        {fileType === "pdf" && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-5 text-amber-700">
              <strong>PDF selecionado.</strong> O layout pode ter pequenas diferenças. Para resultado
              perfeito, abra no Word e salve como <em>.docx</em>.
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</p>
        )}
      </div>
    </div>
  );
}
