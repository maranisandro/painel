import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Painel de Informações — Grupo Plantar",
  description: "Painéis de informações operacionais do Grupo Plantar",
};

// viewportFit: 'cover' é obrigatório para os valores de env(safe-area-inset-*)
// resolverem para algo diferente de 0 (necessário para o padding de segurança
// da barra de abas em telas com notch/home indicator, ver MobileTabBar.tsx) —
// sem isso a barra de navegação não estica atrás da área do sistema e os
// env() ficam sempre zerados, mesmo em iPhones com notch.
export const viewport: Viewport = {
  viewportFit: "cover",
};

// S10 (CSP com nonce, ver src/middleware.ts) — precisa ler o nonce aqui via
// `headers()` para o Next.js aplicá-lo automaticamente nos <script> que ele
// mesmo injeta (bootstrap/chunks); só ler já força renderização dinâmica por
// request, que é o que faz a detecção funcionar. Não precisamos usar o
// valor diretamente — a leitura em si já ativa o comportamento.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await headers();
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
