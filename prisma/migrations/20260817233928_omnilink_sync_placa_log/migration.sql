-- CreateEnum
CREATE TYPE "OmnilinkSyncStatus" AS ENUM ('OK', 'NAO_LOCALIZADA', 'ERRO');

-- CreateTable
CREATE TABLE "omnilink_sync_placa" (
    "id" TEXT NOT NULL,
    "sync_run_id" TEXT,
    "placa" TEXT NOT NULL,
    "status" "OmnilinkSyncStatus" NOT NULL,
    "rows_recebidas" INTEGER NOT NULL DEFAULT 0,
    "ultima_posicao_em" TIMESTAMP(3),
    "mensagem" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omnilink_sync_placa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "omnilink_sync_placa_placa_created_at_idx" ON "omnilink_sync_placa"("placa", "created_at");

-- CreateIndex
CREATE INDEX "omnilink_sync_placa_sync_run_id_idx" ON "omnilink_sync_placa"("sync_run_id");

-- AddForeignKey
ALTER TABLE "omnilink_sync_placa" ADD CONSTRAINT "omnilink_sync_placa_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
