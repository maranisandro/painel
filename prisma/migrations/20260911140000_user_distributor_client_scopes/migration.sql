-- CreateTable
CREATE TABLE "user_distributor_scopes" (
    "user_id" TEXT NOT NULL,
    "distribuidor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_distributor_scopes_pkey" PRIMARY KEY ("user_id","distribuidor")
);

-- CreateTable
CREATE TABLE "user_client_scopes" (
    "user_id" TEXT NOT NULL,
    "cliente" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_client_scopes_pkey" PRIMARY KEY ("user_id","cliente")
);

-- AddForeignKey
ALTER TABLE "user_distributor_scopes" ADD CONSTRAINT "user_distributor_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_scopes" ADD CONSTRAINT "user_client_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
