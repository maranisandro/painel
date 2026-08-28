import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Versão exibida no topo do painel (pedido do usuário 2026-08-17: "colocar a
// versão para sabermos se estamos na última versão e comparar com a versão
// produção") — o build do Docker não tem a pasta .git (está no
// .dockerignore), então recebe o valor pronto via build-arg
// (NEXT_PUBLIC_BUILD_VERSION); em dev local, sem essa env var definida, lê
// direto do git.
function getBuildVersion(): string {
  if (process.env.NEXT_PUBLIC_BUILD_VERSION) return process.env.NEXT_PUBLIC_BUILD_VERSION;
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    const data = execSync("git log -1 --format=%cd --date=format:%Y-%m-%d_%H:%M").toString().trim();
    return `${sha} (${data}, dev local)`;
  } catch {
    return "dev-local (sem git)";
  }
}

// Rótulo de ambiente (pedido do usuário 2026-08-17: "conseguirmos diferenciar
// as versões dev e produção" — o texto de versão sozinho, hash+data, não era
// óbvio à primeira vista). `NEXT_PUBLIC_BUILD_VERSION` só existe quando o
// build passou pelo build-arg do Dockerfile (deploy real) — sem ele, é
// sempre `next dev`/`next build` local.
function getAppEnv(): 'producao' | 'dev' {
  return process.env.NEXT_PUBLIC_BUILD_VERSION ? 'producao' : 'dev';
}

// S10 (revisão de segurança 2026-07-25, "sem CSP/HSTS/hardening HTTP") —
// CSP fica em `src/middleware.ts` (precisa de nonce por request, gerado a
// cada requisição). HSTS de propósito NÃO está aqui: o painel roda em HTTP
// puro, sem TLS/Nginx na frente (decisão já tomada do grupo, ver [[01 -
// Stack e Arquitetura]]), e HSTS não tem nenhum efeito fora de HTTPS.
// Revisitar quando/se o painel ganhar TLS na frente.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Imagem Docker enxuta (só o necessário pra rodar, sem node_modules
  // inteiro) — pedido do usuário 2026-08-12, migração para servidor com
  // Docker (10.10.2.60).
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BUILD_VERSION: getBuildVersion(),
    NEXT_PUBLIC_APP_ENV: getAppEnv(),
  },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
