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
import type { CreatePlanoInput, PlanoRecord, UpdatePlanoInput } from "../../types/firestore";

const planosCollection = collection(firebaseDb, "magis_planos");

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

function mapPlanoRecord(id: string, data: Record<string, unknown>): PlanoRecord {
  return {
    id,
    user_id: typeof data.user_id === "string" ? data.user_id : "",
    template_id: typeof data.template_id === "string" ? data.template_id : "",
    conteudo_gerado:
      typeof data.conteudo_gerado === "object" && data.conteudo_gerado !== null
        ? (data.conteudo_gerado as Record<string, unknown>)
        : {},
    data_geracao: toIsoString(data.data_geracao),
    status: typeof data.status === "string" ? (data.status as PlanoRecord["status"]) : "rascunho",
    ...(Array.isArray(data.schema_campos) ? { schema_campos: data.schema_campos } : {}),
  };
}

export const planosService = {
  async createPlano(input: CreatePlanoInput): Promise<string> {
    const planoRef = await addDoc(planosCollection, {
      user_id: input.user_id,
      template_id: input.template_id,
      conteudo_gerado: input.conteudo_gerado,
      status: input.status,
      data_geracao: serializeDateForWrite(input.data_geracao),
      ...(Array.isArray(input.schema_campos) ? { schema_campos: input.schema_campos } : {}),
      ...(input.arquivo_url ? { arquivo_url: input.arquivo_url } : {}),
      ...(input.arquivo_fillable_url ? { arquivo_fillable_url: input.arquivo_fillable_url } : {}),
    });

    return planoRef.id;
  },

  async listPlanosByUser(userId: string): Promise<PlanoRecord[]> {
    const snapshot = await getDocs(query(planosCollection, where("user_id", "==", userId)));

    return snapshot.docs
      .map((documentSnapshot) => mapPlanoRecord(documentSnapshot.id, documentSnapshot.data()))
      .sort((left, right) => right.data_geracao.localeCompare(left.data_geracao));
  },

  async listPlanosByTemplate(userId: string, templateId: string): Promise<PlanoRecord[]> {
    const snapshot = await getDocs(
      query(planosCollection, where("user_id", "==", userId), where("template_id", "==", templateId)),
    );

    return snapshot.docs
      .map((documentSnapshot) => mapPlanoRecord(documentSnapshot.id, documentSnapshot.data()))
      .sort((left, right) => right.data_geracao.localeCompare(left.data_geracao));
  },

  async getPlanoById(planoId: string): Promise<PlanoRecord | null> {
    const snapshot = await getDoc(doc(planosCollection, planoId));

    if (!snapshot.exists()) {
      return null;
    }

    return mapPlanoRecord(snapshot.id, snapshot.data());
  },

  async updatePlano(planoId: string, input: UpdatePlanoInput): Promise<void> {
    const payload: Record<string, unknown> = {};

    if (typeof input.template_id === "string") {
      payload.template_id = input.template_id;
    }

    if (typeof input.conteudo_gerado === "object" && input.conteudo_gerado !== null) {
      payload.conteudo_gerado = input.conteudo_gerado;
    }

    if (typeof input.status === "string") {
      payload.status = input.status;
    }

    if (typeof input.arquivo_url === "string") {
      payload.arquivo_url = input.arquivo_url;
    }

    if (typeof input.arquivo_fillable_url === "string") {
      payload.arquivo_fillable_url = input.arquivo_fillable_url;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await updateDoc(doc(planosCollection, planoId), payload);
  },

  async deletePlano(planoId: string): Promise<void> {
    await deleteDoc(doc(planosCollection, planoId));
  },
};
