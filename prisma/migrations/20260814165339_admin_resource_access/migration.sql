-- CreateTable
CREATE TABLE "admin_resources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "admin_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_admin_accesses" (
    "user_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_admin_accesses_pkey" PRIMARY KEY ("user_id","resource_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_resources_code_key" ON "admin_resources"("code");

-- CreateIndex
CREATE INDEX "user_admin_accesses_resource_id_idx" ON "user_admin_accesses"("resource_id");

-- AddForeignKey
ALTER TABLE "user_admin_accesses" ADD CONSTRAINT "user_admin_accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_admin_accesses" ADD CONSTRAINT "user_admin_accesses_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "admin_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
