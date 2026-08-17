-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LocationType" ADD VALUE 'CIDADE';
ALTER TYPE "LocationType" ADD VALUE 'POSTO_GASOLINA';
ALTER TYPE "LocationType" ADD VALUE 'OFICINA';
ALTER TYPE "LocationType" ADD VALUE 'RESIDENCIA';

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "motoristaNome" TEXT;

-- CreateTable
CREATE TABLE "LocationVisit" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "chegada" TIMESTAMP(3) NOT NULL,
    "saida" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationVisit_placa_saida_idx" ON "LocationVisit"("placa", "saida");

-- CreateIndex
CREATE INDEX "LocationVisit_locationId_chegada_idx" ON "LocationVisit"("locationId", "chegada");

-- AddForeignKey
ALTER TABLE "LocationVisit" ADD CONSTRAINT "LocationVisit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
