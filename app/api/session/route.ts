import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAdminAuth } from "../../../lib/firebase/admin";

const SESSION_COOKIE_NAME = "__session";
const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000; // 5 dias

export async function POST(request: Request) {
  try {
    const { idToken } = await request.json();

    if (typeof idToken !== "string" || idToken.length === 0) {
      return NextResponse.json({ error: "Token inválido" }, { status: 400 });
    }

    // Cria um session cookie de longa duração (5 dias) em vez de armazenar o ID token bruto
    const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });

    const cookieStore = await cookies();

    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao criar sessão Firebase:", error);
    return NextResponse.json({ error: "Não foi possível criar a sessão" }, { status: 401 });
  }
}

