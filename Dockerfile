# Build multi-stage — imagem final só com o output standalone do Next.js,
# sem devDependencies nem código fonte. Prisma usa driver adapter (pg), então
# não depende do binário nativo do query engine — evita o problema clássico
# de "engine compilado pra plataforma errada" ao buildar num Windows e rodar
# num Linux do servidor.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL fictício só pra satisfazer o schema do Prisma no build — o
# build não abre conexão real (mesmo raciocínio do CI, ver .github/workflows/ci.yml)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build_db"
# NEXT_PUBLIC_* é embutido no bundle do cliente NO MOMENTO DO BUILD (next
# build), não lido em runtime — diferente do resto do .env.production, que o
# docker-compose injeta via env_file quando o container sobe. Sem este ARG, o
# valor real do .env.production nunca chega ao build, mesmo reiniciando o
# container (achado real 2026-08-13: usuário configurou a chave do Google
# Maps em .env.production, mas o mapa continuava pedindo a chave em
# produção — a imagem só é rebuildada com --build-arg
# NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<chave>).
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
# Versão exibida no topo do painel (pedido do usuário 2026-08-17) — a pasta
# .git não existe aqui dentro (está no .dockerignore), por isso o valor vem
# pronto via build-arg (calculado pelo script de deploy a partir do git
# local antes do build), não recalculado no container.
ARG BUILD_VERSION
ENV NEXT_PUBLIC_BUILD_VERSION=$BUILD_VERSION
RUN npx prisma generate
RUN npm run build

# Stage separado só pra rodar `prisma migrate deploy`/`db:seed` sob demanda
# (docker compose run --rm migrate ...) — a imagem final (runner) não tem o
# CLI do Prisma nem devDependencies, de propósito, pra ficar enxuta.
FROM node:20-alpine AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3002
ENV PORT=3002
CMD ["node", "server.js"]
