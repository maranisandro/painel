-- AlterTable
ALTER TABLE "TripTicket" ADD COLUMN     "ocrLog" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "ocrStatus" SET DEFAULT 'processando';
