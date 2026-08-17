-- CreateTable
CREATE TABLE "SpeedAlert" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "speedKmh" DOUBLE PRECISION NOT NULL,
    "limiteKmh" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "localizacao" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeedAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeedAlert_placa_acknowledgedAt_idx" ON "SpeedAlert"("placa", "acknowledgedAt");
