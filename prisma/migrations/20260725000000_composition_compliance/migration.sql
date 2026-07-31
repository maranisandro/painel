
-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "fixedComposition" TEXT;

-- CreateTable
CREATE TABLE "CompositionSpec" (
    "id" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "numEixos" TEXT,
    "pbtcMaximoTon" DECIMAL(65,30),
    "taraMinTon" DECIMAL(65,30),
    "taraMaxTon" DECIMAL(65,30),
    "cargaLiquidaMinTon" DECIMAL(65,30),
    "cargaLiquidaMaxTon" DECIMAL(65,30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "codigoPrd" TEXT NOT NULL,
    "produtoNome" TEXT,
    "tipoProduto" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompositionSpec_composition_key" ON "CompositionSpec"("composition");

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_codigoPrd_key" ON "ProductType"("codigoPrd");

