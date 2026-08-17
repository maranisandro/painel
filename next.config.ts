import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagem Docker enxuta (só o necessário pra rodar, sem node_modules
  // inteiro) — pedido do usuário 2026-08-12, migração para servidor com
  // Docker (10.10.2.60).
  output: 'standalone',
};

export default nextConfig;
