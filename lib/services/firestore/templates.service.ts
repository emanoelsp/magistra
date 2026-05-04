import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { firebaseDb } from "../../firebase/client";
import type {
  CreateTemplateInput,
  TemplateFieldSchema,
  TemplateRecord,
  UpdateTemplateInput,
} from "../../types/firestore";

const templatesCollection = collection(firebaseDb, "templates");

function isTemplateFieldSchemaArray(value: unknown): value is TemplateFieldSchema[] {
  return Array.isArray(value);
}

function toIsoString(value: unknown): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }

  return new Date().toISOString();
}

function serializeDateForWrite(value?: string) {
  if (!value) {
    return serverTimestamp();
  }

  return Timestamp.fromDate(new Date(value));
}

function mapTemplateRecord(id: string, data: Record<string, unknown>): TemplateRecord {
  const rawMeta = data.metadata_padrao;
  const metadata_padrao: Record<string, string> | undefined =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, string>)
      : undefined;

  return {
    id,
    user_id: typeof data.user_id === "string" ? data.user_id : "",
    nome: typeof data.nome === "string" ? data.nome : "",
    escola_nome: typeof data.escola_nome === "string" ? data.escola_nome : null,
    tipo_plano: typeof data.tipo_plano === "string" ? data.tipo_plano : null,
    schema_campos: isTemplateFieldSchemaArray(data.schema_campos) ? data.schema_campos : [],
    data_criacao: toIsoString(data.data_criacao),
    metadata_padrao,
    arquivo_url: typeof data.arquivo_url === "string" ? data.arquivo_url : undefined,
  };
}

export const templatesService = {
  async createTemplate(input: CreateTemplateInput): Promise<string> {
    const templateRef = await addDoc(templatesCollection, {
      user_id: input.user_id,
      nome: input.nome.trim(),
      escola_nome: input.escola_nome?.trim() ?? null,
      tipo_plano: input.tipo_plano?.trim() ?? null,
      schema_campos: input.schema_campos,
      data_criacao: serializeDateForWrite(input.data_criacao),
    });

    return templateRef.id;
  },

  async listTemplatesByUser(userId: string): Promise<TemplateRecord[]> {
    const snapshot = await getDocs(query(templatesCollection, where("user_id", "==", userId)));

    return snapshot.docs
      .map((documentSnapshot) => mapTemplateRecord(documentSnapshot.id, documentSnapshot.data()))
      .sort((left, right) => right.data_criacao.localeCompare(left.data_criacao));
  },

  async getTemplateById(templateId: string): Promise<TemplateRecord | null> {
    const snapshot = await getDoc(doc(templatesCollection, templateId));

    if (!snapshot.exists()) {
      return null;
    }

    return mapTemplateRecord(snapshot.id, snapshot.data());
  },

  async updateTemplate(templateId: string, input: UpdateTemplateInput): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (typeof input.nome === "string") {
      payload.nome = input.nome.trim();
    }

    if (Array.isArray(input.schema_campos)) {
      payload.schema_campos = input.schema_campos;
    }

    if (input.metadata_padrao && typeof input.metadata_padrao === "object") {
      payload.metadata_padrao = input.metadata_padrao;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await updateDoc(doc(templatesCollection, templateId), payload);
  },

  async saveMetadataPadrao(templateId: string, metadata: Record<string, string>): Promise<void> {
    const cleaned = Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
    );
    await updateDoc(doc(templatesCollection, templateId), { metadata_padrao: cleaned });
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await deleteDoc(doc(templatesCollection, templateId));
  },
};
