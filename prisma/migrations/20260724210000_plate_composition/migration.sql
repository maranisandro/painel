-- Composicao (implemento) por placa com historico de mudancas por data
CREATE TABLE "PlateComposition" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlateComposition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlateComposition_placa_effectiveFrom_idx" ON "PlateComposition"("placa", "effectiveFrom");
