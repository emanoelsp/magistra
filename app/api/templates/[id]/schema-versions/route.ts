import "server-only";

import { NextResponse } from "next/server";

import { getAdminDb } from "../../../../../lib/firebase/admin";
import { requireCurrentUserProfile } from "../../../../../lib/auth/session";
import type { TemplateFieldSchema } from "../../../../../lib/types/firestore";

interface SchemaVersion {
  id: string;
  schema_campos: TemplateFieldSchema[];
  salvo_em: string;
  tipo: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let user: Awaited<ReturnType<typeof requireCurrentUserProfile>>;
    try {
      user = await requireCurrentUserProfile();
    } catch {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const db = getAdminDb();

    const templateSnap = await db.collection("magis_templates").doc(id).get();
    if (!templateSnap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }
    if (templateSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const versionsSnap = await db
      .collection("magis_templates")
      .doc(id)
      .collection("schema_versions")
      .orderBy("salvo_em", "desc")
      .limit(10)
      .get();

    const versions: SchemaVersion[] = versionsSnap.docs.map((doc) => ({
      id: doc.id,
      schema_campos: doc.data().schema_campos ?? [],
      salvo_em: doc.data().salvo_em ?? "",
      tipo: doc.data().tipo ?? "manual",
    }));

    return NextResponse.json({ ok: true, versions });
  } catch (error) {
    console.error("[schema-versions] Erro:", error);
    return NextResponse.json({ error: "Falha ao listar versões." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let user: Awaited<ReturnType<typeof requireCurrentUserProfile>>;
    try {
      user = await requireCurrentUserProfile();
    } catch {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const db = getAdminDb();

    const templateSnap = await db.collection("magis_templates").doc(id).get();
    if (!templateSnap.exists) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }
    if (templateSnap.data()?.user_id !== user.uid) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }

    const body = (await request.json()) as { version_id: string };
    if (!body.version_id) {
      return NextResponse.json({ error: "version_id obrigatório." }, { status: 400 });
    }

    const versionSnap = await db
      .collection("magis_templates")
      .doc(id)
      .collection("schema_versions")
      .doc(body.version_id)
      .get();

    if (!versionSnap.exists) {
      return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 });
    }

    const schema_campos = versionSnap.data()?.schema_campos ?? [];

    // Save current schema as a version before restoring
    await db.collection("magis_templates").doc(id).collection("schema_versions").add({
      schema_campos: templateSnap.data()?.schema_campos ?? [],
      salvo_em: new Date().toISOString(),
      tipo: "pre_restauracao",
    });

    await db.collection("magis_templates").doc(id).update({ schema_campos });

    return NextResponse.json({ ok: true, schema_campos });
  } catch (error) {
    console.error("[schema-versions] Restaurar erro:", error);
    return NextResponse.json({ error: "Falha ao restaurar versão." }, { status: 500 });
  }
}
