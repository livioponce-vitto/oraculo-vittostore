import { PrismaClient, RecoveryStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Clean existing seed data to make re-runs idempotent
  await prisma.recoveryLog.deleteMany({});
  await prisma.recoveryEvent.deleteMany({});

  // ── 1. queued ──────────────────────────────────────────────────────────────
  await prisma.recoveryEvent.create({
    data: {
      dedupeKey: "seed-checkout-queued-001",
      phone: "+56912345678",
      customerName: "Valentina Rojas",
      checkoutUrl:
        "https://vittostore.myshopify.com/checkouts/abc123?token=tk_queued_001",
      source: "shopify_checkout_webhook",
      status: RecoveryStatus.queued,
      attempts: 0,
    },
  });

  // ── 2. sent ────────────────────────────────────────────────────────────────
  const sentEvent = await prisma.recoveryEvent.create({
    data: {
      dedupeKey: "seed-checkout-sent-002",
      phone: "+56987654321",
      customerName: "Matías Fuentes",
      checkoutUrl:
        "https://vittostore.myshopify.com/checkouts/def456?token=tk_sent_002",
      source: "shopify_checkout_webhook",
      status: RecoveryStatus.sent,
      attempts: 1,
      sentAt: new Date(),
    },
  });

  await prisma.recoveryLog.createMany({
    data: [
      {
        eventId: sentEvent.id,
        level: "info",
        stage: "whatsapp_send",
        message: "Mensaje de recuperación enviado exitosamente",
        payload: { messageId: "wamid.ABCD1234", phone: sentEvent.phone },
      },
      {
        eventId: sentEvent.id,
        level: "info",
        stage: "status_update",
        message: "Estado actualizado a sent",
        payload: { previousStatus: "queued", newStatus: "sent" },
      },
    ],
  });

  // ── 3. failed ──────────────────────────────────────────────────────────────
  const failedEvent = await prisma.recoveryEvent.create({
    data: {
      dedupeKey: "seed-checkout-failed-003",
      phone: "+56911223344",
      customerName: "Camila Torres",
      checkoutUrl:
        "https://vittostore.myshopify.com/checkouts/ghi789?token=tk_failed_003",
      source: "shopify_checkout_webhook",
      status: RecoveryStatus.failed,
      attempts: 3,
      lastError: "WhatsApp API timeout after 3 retries",
    },
  });

  await prisma.recoveryLog.create({
    data: {
      eventId: failedEvent.id,
      level: "error",
      stage: "whatsapp_send",
      message: "Error al enviar mensaje: timeout de conexión",
      payload: {
        error: "WhatsApp API timeout after 3 retries",
        attempts: 3,
        phone: failedEvent.phone,
      },
    },
  });

  // ── 4. duplicate ───────────────────────────────────────────────────────────
  await prisma.recoveryEvent.create({
    data: {
      dedupeKey: "seed-checkout-duplicate-004",
      phone: "+56955667788",
      customerName: "Ignacio Pérez",
      checkoutUrl:
        "https://vittostore.myshopify.com/checkouts/jkl012?token=tk_dup_004",
      source: "shopify_checkout_webhook",
      status: RecoveryStatus.duplicate,
      attempts: 0,
    },
  });

  // ── 5. skipped ─────────────────────────────────────────────────────────────
  await prisma.recoveryEvent.create({
    data: {
      dedupeKey: "seed-checkout-skipped-005",
      phone: "+56933445566",
      customerName: "Fernanda Soto",
      checkoutUrl:
        "https://vittostore.myshopify.com/checkouts/mno345?token=tk_skip_005",
      source: "shopify_checkout_webhook",
      status: RecoveryStatus.skipped,
      attempts: 0,
      lastError: "Customer opted out of WhatsApp notifications",
    },
  });

  const eventCount = await prisma.recoveryEvent.count();
  const logCount = await prisma.recoveryLog.count();
  console.log(
    `✅ Seed complete: ${eventCount} RecoveryEvent records, ${logCount} RecoveryLog records`
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
