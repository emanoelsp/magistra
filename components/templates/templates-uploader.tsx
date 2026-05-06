"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, CloudUpload, FileText } from "lucide-react";

import { templatesService } from "../../lib/services/firestore/templates.service";

interface TemplatesUploaderProps {
  userId: string;
}

export function TemplatesUploader({ userId }: TemplatesUploaderProps) {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escolaNome, setEscolaNome] = useState("");
  const [tipoPlano, setTipoPlano] = useState("");
  const [selectedFileType, setSelectedFileType] = useState<"docx" | "pdf" | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (!escolaNome.trim() || !tipoPlano.trim()) {
      setError("Informe o nome da escola e o tipo de plano antes de enviar o arquivo.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const file = files[0];

      const templateId = await templatesService.createTemplate({
        user_id: userId,
        nome: file.name.replace(/\.(pdf|docx?)$/i, ""),
        escola_nome: escolaNome,
        tipo_plano: tipoPlano,
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

      const introspectData = (await introspectRes.json().catch(() => null)) as { error?: string; schema?: unknown } | null;
      if (!introspectRes.ok) {
        throw new Error(introspectData?.error ?? "Falha ao extrair campos do arquivo.");
      }

      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível criar o template.";
      setError(message);
    } finally {
      setIsUploading(false);
    }
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      setSelectedFileType(ext === "docx" || ext === "doc" ? "docx" : "pdf");
    }
    void handleFiles(event.target.files);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      setSelectedFileType(ext === "docx" || ext === "doc" ? "docx" : "pdf");
    }
    void handleFiles(event.dataTransfer.files);
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="relative flex h-full cursor-pointer flex-col gap-4 overflow-hidden rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8"
    >
      {isUploading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-3xl bg-white/95 backdrop-blur-sm">
          <div className="relative flex items-center justify-center">
            <div className="h-14 w-14 animate-spin rounded-full border-4 border-slate-100 border-t-violet-600" />
            <div className="absolute flex h-8 w-8 items-center justify-center rounded-full bg-violet-100">
              <FileText className="h-4 w-4 text-violet-600" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-slate-900">Processando template…</p>
            <p className="mt-1 text-sm text-slate-500">A IA está extraindo os campos do arquivo.</p>
            <p className="mt-0.5 text-xs text-slate-400">Isso pode levar alguns segundos.</p>
          </div>
        </div>
      )}
      {/* Fidelity notice — always visible */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Use Word (.docx) para fidelidade 100% ao template original
            </p>
            <p className="mt-1 text-xs leading-5 text-emerald-700">
              Com DOCX, o download preserva <strong>exatamente</strong> o layout da escola — cabeçalho com logo,
              tabelas, colunas, rodapé, fontes e cores. O sistema detecta os campos automaticamente e
              preenche sem alterar nada do visual.
            </p>
            <p className="mt-2 text-xs text-emerald-600">
              Não tem o .docx? Abra o PDF no Word e salve como <em>.docx</em>, ou peça ao secretário da escola.
            </p>
          </div>
        </div>
      </div>

      {/* PDF warning — shown only when PDF is selected */}
      {selectedFileType === "pdf" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                PDF selecionado — fidelidade do download pode ser aproximada
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                PDFs não são editáveis por natureza. O sistema fará o melhor possível para preservar o
                layout, mas imagens, cores e a posição exata de alguns campos podem não ser reproduzidas
                fielmente. Para resultado perfeito, converta para .docx antes de subir.
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedFileType === "docx" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-800">
              Ótimo! Arquivo Word — download fiel garantido.
            </p>
          </div>
        </div>
      )}

      <div className="flex w-full flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Nome da escola</span>
            <input
              type="text"
              value={escolaNome}
              onChange={(event) => setEscolaNome(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              placeholder="Ex.: Escola Municipal João XXIII"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-700">Tipo de plano</span>
            <div className="relative mt-2">
              <select
                value={tipoPlano}
                onChange={(event) => setTipoPlano(event.target.value)}
                className="w-full appearance-none rounded-2xl border border-slate-300 bg-white px-3 py-2 pr-9 text-sm text-slate-950 outline-none transition focus:border-slate-950"
              >
                <option value="">Selecione um tipo</option>
                <option value="plano_anual">Plano anual</option>
                <option value="plano_semestral">Plano semestral</option>
                <option value="plano_quinzenal">Plano quinzenal</option>
                <option value="plano_de_aula">Plano de aula</option>
                <option value="sequencia_didatica">Sequência didática</option>
                <option value="situacao_de_aprendizagem">Situação de aprendizagem</option>
                <option value="projeto_de_extensao">Projeto de extensão</option>
                <option value="caso_de_uso">Caso de uso</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </label>
        </div>

        <label className="flex w-full cursor-pointer items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <CloudUpload className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-950">
              Upload do template da escola
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Suba o arquivo Word (.docx) ou PDF do template.
              Arraste aqui ou clique para selecionar.
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <FileText className="h-3.5 w-3.5" />
                .docx — fidelidade perfeita
              </span>
              <span className="text-xs text-slate-400">
                .pdf — fidelidade aproximada
              </span>
            </div>
          </div>
          <input
            type="file"
            accept=".docx,.doc,.pdf"
            className="hidden"
            onChange={onFileChange}
            disabled={isUploading}
          />
        </label>
      </div>

      {!isUploading && (
        <p className="text-xs text-slate-500">
          Formatos aceitos: <strong>.docx</strong> (recomendado) e .pdf
        </p>
      )}

      {error ? (
        <p className="text-xs text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
