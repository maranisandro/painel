-- Reestruturação do cadastro de rotas: origem/destino viram FKs para o novo
-- cadastro de Locais (unidades e clientes); distância separada em asfalto e
-- terra; velocidades separadas em cheio (carregado) e vazio.
-- Os dados de Route eram somente do seed e são recriados por ele — por isso
-- a migração é escrita de forma defensiva (drop e recria).

DROP TABLE IF EXISTS "Route";
DROP TABLE IF EXISTS "Location";
DROP TYPE IF EXISTS "LocationType";

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('UNIDADE', 'CLIENTE');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "matchColigada" INTEGER,
    "matchFilial" INTEGER,
    "matchClientePattern" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "distanceAsphaltKm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "distanceDirtKm" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "speedLoadedKmh" DECIMAL(65,30),
    "speedEmptyKmh" DECIMAL(65,30),
    "loadMinutes" INTEGER,
    "unloadMinutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Route_originId_destinationId_key" ON "Route"("originId", "destinationId");

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
