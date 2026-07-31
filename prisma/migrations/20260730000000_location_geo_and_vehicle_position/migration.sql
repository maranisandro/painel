-- Habilita a extensão PostGIS (pedido do usuário 2026-07-30, integração de
-- rastreamento Omnilink) — preparação para consultas espaciais futuras
-- (distância até a rota, geofencing por raio) assim que a integração real
-- estiver validada. Lat/lng das tabelas abaixo continuam em colunas simples
-- por enquanto (Prisma não modela tipos PostGIS nativos sem SQL bruto).
CREATE EXTENSION IF NOT EXISTS postgis;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "raioMetros" DOUBLE PRECISION DEFAULT 500;

-- CreateTable
CREATE TABLE "VehiclePosition" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "status" TEXT,
    "source" TEXT NOT NULL DEFAULT 'OMNILINK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehiclePosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehiclePosition_placa_capturedAt_idx" ON "VehiclePosition"("placa", "capturedAt");

