import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sora } from "next/font/google";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PlanoMagistra — Seu plano de aula pronto em minutos",
  description:
    "Reduza 70% do tempo com burocracia escolar. Suba o template da sua escola, a IA extrai a estrutura e sugere conteúdos campo a campo — BNCC, SAEB e CTBC.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="pt-BR" className={sora.variable}>
      <body className="bg-white text-slate-950 antialiased">{children}</body>
    </html>
  );
}
