-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'TALHAO';

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "precisa_rastreamento" BOOLEAN NOT NULL DEFAULT true,
    "cod_tra" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_type_rules" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "codtmv" TEXT,
    "produtos" TEXT,
    "origem_coligada" INTEGER,
    "origem_filial" INTEGER,
    "destino_coligada" INTEGER,
    "destino_filial" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_type_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_placa_key" ON "vehicles"("placa");

-- CreateIndex
CREATE INDEX "transport_type_rules_ativo_prioridade_idx" ON "transport_type_rules"("ativo", "prioridade");
