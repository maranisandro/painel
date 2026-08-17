
-- DropIndex
DROP INDEX "VehiclePosition_placa_capturedAt_idx";

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePosition_placa_capturedAt_key" ON "VehiclePosition"("placa", "capturedAt");

