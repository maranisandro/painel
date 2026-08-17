-- AlterTable
ALTER TABLE "TripTicket" ADD COLUMN     "ocrStatus" TEXT NOT NULL DEFAULT 'pendente',
ADD COLUMN     "ocrTexto" TEXT,
ALTER COLUMN "placa" DROP NOT NULL,
ALTER COLUMN "pesoAproximadoTon" DROP NOT NULL,
ALTER COLUMN "dataTicket" DROP NOT NULL;
