import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminAuth, getAdminDb } from "../firebase/admin";
import { normalizePlanKey } from "../services/plan-config";
import type { UserProfile } from "../types/firestore";

const SESSION_COOKIE_NAME = "__session";

interface SessionIdentity {
  uid: string;
  email?: string;
  name?: string;
}

export const getCurrentSession = cache(async (): Promise<SessionIdentity | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    // verifySessionCookie verifica o session cookie de longa duração (createSessionCookie)
    const decodedToken = await getAdminAuth().verifySessionCookie(sessionCookie, true);

    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
  } catch {
    return null;
  }
});

export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  const session = await getCurrentSession();

  if (!session) {
    return null;
  }

  const db = getAdminDb();
  const userSnapshot = await db.collection("magis_users").doc(session.uid).get();
  const userData = userSnapshot.data() ?? {};

  // Self-healing migration: users who became segundo_professor before the flag
  // was stored on UserRecord can be recovered by scanning their turmas once.
  let is_segundo_professor = userData.is_segundo_professor === true;
  if (!is_segundo_professor) {
    const turmasSnap = await db
      .collection("magis_turmas")
      .where("user_id", "==", session.uid)
      .where("tipo_professor", "==", "segundo_professor")
      .limit(1)
      .get();
    if (!turmasSnap.empty) {
      is_segundo_professor = true;
      void db.collection("magis_users").doc(session.uid).update({ is_segundo_professor: true });
    }
  }

  return {
    uid: session.uid,
    nome: typeof userData.nome === "string" && userData.nome.length > 0 ? userData.nome : session.name ?? "",
    email: typeof userData.email === "string" && userData.email.length > 0 ? userData.email : session.email ?? "",
    escola_padrao:
      typeof userData.escola_padrao === "string" && userData.escola_padrao.length > 0
        ? userData.escola_padrao
        : null,
    plano: normalizePlanKey(typeof userData.plano === "string" ? userData.plano : null),
    plano_validade: typeof userData.plano_validade === "string" ? userData.plano_validade : null,
    tokens_usados_mes:
      typeof userData.tokens_usados_mes === "number" && Number.isFinite(userData.tokens_usados_mes)
        ? userData.tokens_usados_mes
        : 0,
    role: userData.role === "admin" ? "admin" : "professor",
    is_segundo_professor,
  };
});

export async function requireCurrentUserProfile(): Promise<UserProfile> {
  const user = await getCurrentUserProfile();

  if (!user) {
    redirect("/login");
  }

  return user;
}
