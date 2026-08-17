-- CreateTable
CREATE TABLE "CriticaModeloAchado" (
    "id" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "reconhecidoPor" TEXT,
    "reconhecidoEm" TIMESTAMP(3),
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriticaModeloAchado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CriticaModeloAchado_modulo_chave_key" ON "CriticaModeloAchado"("modulo", "chave");
