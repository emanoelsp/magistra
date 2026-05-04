import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminAuth, getAdminDb } from "../firebase/admin";
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
    const decodedToken = await getAdminAuth().verifyIdToken(sessionCookie);

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

  const userSnapshot = await getAdminDb().collection("users").doc(session.uid).get();
  const userData = userSnapshot.data() ?? {};

  return {
    uid: session.uid,
    nome: typeof userData.nome === "string" && userData.nome.length > 0 ? userData.nome : session.name ?? "",
    email: typeof userData.email === "string" && userData.email.length > 0 ? userData.email : session.email ?? "",
    escola_padrao:
      typeof userData.escola_padrao === "string" && userData.escola_padrao.length > 0
        ? userData.escola_padrao
        : null,
    plano: typeof userData.plano === "string" && userData.plano.length > 0 ? userData.plano : "free",
    tokens_usados_mes:
      typeof userData.tokens_usados_mes === "number" && Number.isFinite(userData.tokens_usados_mes)
        ? userData.tokens_usados_mes
        : 0,
  };
});

export async function requireCurrentUserProfile(): Promise<UserProfile> {
  const user = await getCurrentUserProfile();

  if (!user) {
    redirect("/login");
  }

  return user;
}
