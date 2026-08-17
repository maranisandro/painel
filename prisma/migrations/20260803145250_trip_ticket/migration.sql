-- CreateTable
CREATE TABLE "TripTicket" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "pesoAproximadoTon" DECIMAL(65,30) NOT NULL,
    "dataTicket" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileMime" TEXT NOT NULL,
    "fileData" BYTEA NOT NULL,
    "matchedTripKey" TEXT,
    "conferidoEm" TIMESTAMP(3),
    "conferidoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripTicket_placa_dataTicket_idx" ON "TripTicket"("placa", "dataTicket");
