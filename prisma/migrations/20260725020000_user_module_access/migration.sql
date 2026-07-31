-- AlterTable
ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserModuleAccess" (
    "userId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserModuleAccess_pkey" PRIMARY KEY ("userId","moduleId")
);

-- CreateIndex
CREATE INDEX "UserModuleAccess_moduleId_idx" ON "UserModuleAccess"("moduleId");

-- AddForeignKey
ALTER TABLE "UserModuleAccess"
ADD CONSTRAINT "UserModuleAccess_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserModuleAccess"
ADD CONSTRAINT "UserModuleAccess_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "Module"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserva o comportamento dos usuários não administradores já existentes:
-- eles recebem os módulos que estavam ativos antes desta migration.
INSERT INTO "UserModuleAccess" ("userId", "moduleId")
SELECT u."id", m."id"
FROM "User" u CROSS JOIN "Module" m
WHERE u."role" <> 'ADMIN' AND m."active" = true
ON CONFLICT DO NOTHING;
