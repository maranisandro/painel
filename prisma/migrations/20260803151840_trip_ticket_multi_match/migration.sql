/*
  Warnings:

  - You are about to drop the column `matchedTripKey` on the `TripTicket` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TripTicket" DROP COLUMN "matchedTripKey",
ADD COLUMN     "matchedTripKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
