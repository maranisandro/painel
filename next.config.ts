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

const nextConfig: NextConfig = {
  // Imagem Docker enxuta (só o necessário pra rodar, sem node_modules
  // inteiro) — pedido do usuário 2026-08-12, migração para servidor com
  // Docker (10.10.2.60).
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BUILD_VERSION: getBuildVersion(),
  },
};

export default nextConfig;
