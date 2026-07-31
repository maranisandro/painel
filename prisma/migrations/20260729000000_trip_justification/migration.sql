-- CreateTable
CREATE TABLE "TripJustification" (
    "id" TEXT NOT NULL,
    "tripKey" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripJustification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripJustification_tripKey_key" ON "TripJustification"("tripKey");
