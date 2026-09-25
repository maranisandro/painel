-- CreateEnum
CREATE TYPE "OmnilinkBackfillStatus" AS ENUM ('PENDENTE', 'CONCLUIDA', 'NAO_LOCALIZADA');

-- CreateTable
CREATE TABLE "omnilink_backfill_placa" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "status" "OmnilinkBackfillStatus" NOT NULL DEFAULT 'PENDENTE',
    "cursor_at" TIMESTAMP(3) NOT NULL,
    "posicoes_gravadas" INTEGER NOT NULL DEFAULT 0,
    "falhas_seguidas" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "janelas_com_erro" JSONB NOT NULL DEFAULT '[]',
    "concluida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omnilink_backfill_placa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "omnilink_backfill_placa_placa_key" ON "omnilink_backfill_placa"("placa");

-- CreateIndex
CREATE INDEX "omnilink_backfill_placa_status_created_at_idx" ON "omnilink_backfill_placa"("status", "created_at");
