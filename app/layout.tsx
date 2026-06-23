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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://planomagistra.com.br";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "PlanoMagistra — Seu plano de aula pronto em minutos",
  description:
    "Reduza 70% do tempo com burocracia escolar. Suba o template da sua escola, a Magis extrai a estrutura e sugere conteúdos campo a campo — BNCC, SAEB e currículo específico de cada território nacional.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    siteName: "PlanoMagistra",
    title: "PlanoMagistra — Seu plano de aula pronto em minutos",
    description:
      "Reduza 70% do tempo com burocracia escolar. Suba o template da sua escola, a Magis extrai a estrutura e sugere conteúdos campo a campo.",
    images: [
      {
        url: "/images/logo.png",
        width: 512,
        height: 512,
        alt: "PlanoMagistra",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PlanoMagistra — Seu plano de aula pronto em minutos",
    description:
      "Reduza 70% do tempo com burocracia escolar. BNCC, SAEB e currículo territorial com a Magis.",
    images: ["/images/logo.png"],
  },
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
