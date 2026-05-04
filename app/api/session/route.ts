import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAdminAuth } from "../../../lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (typeof idToken !== "string" || idToken.length === 0) {
      return NextResponse.json({ error: "Token inválido" }, { status: 400 });
    }

    // Valida o token no backend para garantir que é um ID token do Firebase
    await getAdminAuth().verifyIdToken(idToken);

    const cookieStore = await cookies();

    cookieStore.set(SESSION_COOKIE_NAME, idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60, // 1 hora em segundos
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao criar sessão Firebase:", error);
    return NextResponse.json({ error: "Não foi possível criar a sessão" }, { status: 401 });
  }
}

