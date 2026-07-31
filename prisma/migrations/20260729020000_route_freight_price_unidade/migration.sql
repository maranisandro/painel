-- CreateEnum
CREATE TYPE "FreightRateUnit" AS ENUM ('KM', 'TONELADA', 'MDC', 'M3');

-- AlterTable
ALTER TABLE "RouteFreightPrice" ADD COLUMN     "unidade" "FreightRateUnit" NOT NULL DEFAULT 'TONELADA';

