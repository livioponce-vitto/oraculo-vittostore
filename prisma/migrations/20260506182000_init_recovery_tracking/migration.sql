-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('queued', 'sent', 'failed', 'duplicate', 'skipped');

-- CreateTable
CREATE TABLE "RecoveryEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "phone" TEXT,
    "customerName" TEXT,
    "checkoutUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'shopify_checkout_webhook',
    "status" "RecoveryStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryEvent_dedupeKey_key" ON "RecoveryEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "RecoveryLog_eventId_createdAt_idx" ON "RecoveryLog"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecoveryLog" ADD CONSTRAINT "RecoveryLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RecoveryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;