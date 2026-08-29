-- CreateEnum
CREATE TYPE "UsageEventType" AS ENUM ('PAGE_VIEW', 'HEARTBEAT');

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "UsageEventType" NOT NULL,
    "path" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_events_user_id_occurred_at_idx" ON "usage_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_events_module_occurred_at_idx" ON "usage_events"("module", "occurred_at");

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
