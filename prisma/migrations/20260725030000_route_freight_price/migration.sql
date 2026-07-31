
-- CreateTable
CREATE TABLE "RouteFreightPrice" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "valorReferencia" DECIMAL(65,30) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteFreightPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteFreightPrice_routeId_effectiveFrom_idx" ON "RouteFreightPrice"("routeId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "RouteFreightPrice" ADD CONSTRAINT "RouteFreightPrice_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

