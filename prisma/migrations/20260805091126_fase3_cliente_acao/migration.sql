-- CreateTable
CREATE TABLE "Fase3ClienteAcao" (
    "id" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "observacao" TEXT,
    "atualizadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fase3ClienteAcao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fase3ClienteAcao_cliente_key" ON "Fase3ClienteAcao"("cliente");
