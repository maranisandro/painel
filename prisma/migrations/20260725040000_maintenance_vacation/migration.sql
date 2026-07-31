
-- CreateTable
CREATE TABLE "VehicleMaintenance" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverVacation" (
    "id" TEXT NOT NULL,
    "motorista" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverVacation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleMaintenance_placa_startDate_idx" ON "VehicleMaintenance"("placa", "startDate");

-- CreateIndex
CREATE INDEX "DriverVacation_motorista_startDate_idx" ON "DriverVacation"("motorista", "startDate");

