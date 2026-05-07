-- CreateTable BaileysAuthKV
CREATE TABLE "BaileysAuthKV" (
    "key" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaileysAuthKV_pkey" PRIMARY KEY ("key")
);
