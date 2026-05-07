import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import {
  appendRecoveryLog,
  getRecoveryStoreHealth,
  PersistedRecoveryStatus,
  recordRecoveryEvent
} from './recovery-store';
import { enviarMensajeWhatsApp, getWhatsAppHealth } from './whatsapp';

dotenv.config();

// ─── CONFIGURACIÓN GLOBAL ─────────────────────────────────────────────────────
// Edita aquí o define en .env para cambiar sin tocar lógica.

/** Permalink de checkout directo al producto de alto ticket de VITTOSTORE. */
const CHECKOUT_URL_LUXURY =
  process.env.CHECKOUT_URL_LUXURY ?? 'https://vittostore.store/cart/51578668482848:1';

/**
 * Tiempo (en segundos) que debe haber pasado desde el abandono antes de disparar.
 * También define la ventana de deduplicación: no se envía dos veces al mismo
 * checkout dentro de este intervalo.
 */
const ABANDONED_CHECKOUT_TIMEOUT_S =
  Number(process.env.ABANDONED_CHECKOUT_TIMEOUT_S ?? 3600);

/**
 * Canal de mensajería. Actualmente se usa Baileys (WhatsApp directo via QR).
 * Si en el futuro migras a la API oficial de Meta, actualiza este valor y el
 * módulo whatsapp.ts para reflejarlo.
 */
const WHATSAPP_API_ENDPOINT =
  process.env.WHATSAPP_API_ENDPOINT ?? 'baileys://local';
const WA_RETRY_BASE_DELAY_MS = Number(process.env.WA_RETRY_BASE_DELAY_MS ?? 5000);
const QUEUE_ALERT_THRESHOLD = Number(process.env.QUEUE_ALERT_THRESHOLD ?? 20);
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';

/**
 * Construye el cuerpo del mensaje de recuperación con tono de lujo.
 * Recibe el nombre del cliente y la URL de checkout a usar.
 */
const MESSAGE_TEMPLATE = (customerFirstName: string, checkoutUrl: string): string =>
  `¡Hola ${customerFirstName}! 👋

Tu Ritual Moliae te espera. ✨ Hemos reservado tu Set de Lujo para envío inmediato aquí:
${checkoutUrl}

¿Tuviste algún inconveniente con el pago o el envío? Responde este mensaje y te ayudo al instante. 🤝

¡Quedo a tu disposición!`;

type RecoveryStatus = 'queued' | 'sent' | 'failed' | 'duplicate' | 'skipped';

type RecoveryTracking = {
  status: RecoveryStatus;
  attempts: number;
  lastError?: string;
  updatedAt: number;
};

// ─── ESTADO DE RECUPERACIÓN ───────────────────────────────────────────────────
/**
 * RECOVERY_STATUS_TRACKING: Map en memoria que actúa como registro de envíos.
 * Clave: dedupeKey del checkout. Valor: timestamp del primer envío.
 * Impide reenviar el mensaje al mismo cliente dentro de ABANDONED_CHECKOUT_TIMEOUT_S.
 * En el futuro puedes reemplazar este Map por una tabla en base de datos
 * para persistencia entre reinicios.
 */
const RECOVERY_STATUS_TRACKING = new Map<string, number>();
const MESSAGE_TRACKER = new Map<string, RecoveryTracking>();
const WA_TASK_QUEUE: Array<() => Promise<void>> = [];
const WA_MAX_ATTEMPTS = 3;
let isQueueWorkerRunning = false;
let isQueueAlertActive = false;

// ─── APP ──────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const WEBHOOK_DEDUPE_WINDOW_MS = ABANDONED_CHECKOUT_TIMEOUT_S * 1000;

console.log(`[Config] CHECKOUT_URL_LUXURY     = ${CHECKOUT_URL_LUXURY}`);
console.log(`[Config] ABANDONED_CHECKOUT_TIMEOUT_S = ${ABANDONED_CHECKOUT_TIMEOUT_S}s`);
console.log(`[Config] WHATSAPP_API_ENDPOINT   = ${WHATSAPP_API_ENDPOINT}`);
console.log(`[Config] WA_RETRY_BASE_DELAY_MS = ${WA_RETRY_BASE_DELAY_MS}ms`);
console.log(`[Config] QUEUE_ALERT_THRESHOLD  = ${QUEUE_ALERT_THRESHOLD}`);

type RequestWithRawBody = Request & { rawBody?: Buffer };

const hasValidShopifyHmac = (req: RequestWithRawBody) => {
  if (!SHOPIFY_WEBHOOK_SECRET) {
    return false;
  }

  const hmacHeader = req.get('x-shopify-hmac-sha256');
  if (!hmacHeader || !req.rawBody) {
    return false;
  }

  const digest = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('base64');

  const headerBuffer = Buffer.from(hmacHeader, 'utf8');
  const digestBuffer = Buffer.from(digest, 'utf8');

  if (headerBuffer.length !== digestBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(headerBuffer, digestBuffer);
};

const normalizePhone = (raw: string) => {
  let cleaned = raw.replace(/\D/g, '');

  if (cleaned.length === 9 && cleaned.startsWith('9')) {
    cleaned = `56${cleaned}`;
    console.log(`🔧 Autocorrección de número aplicada: ${cleaned}`);
  }

  return cleaned;
};

const isValidPhoneForWhatsApp = (phone: string) => /^\d{11,15}$/.test(phone);

const isValidRecoveryUrl = (value: unknown) => {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  // Evita links de pruebas/manuales que no abren checkout real.
  const blockedSnippets = ['example.com', 'test-vittostore-recovery', '/test'];
  if (blockedSnippets.some((snippet) => trimmed.toLowerCase().includes(snippet))) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
};

const markAndCheckDuplicate = (key: string) => {
  const now = Date.now();

  // Limpia entradas expiradas del registro de recuperación.
  for (const [trackedKey, timestamp] of RECOVERY_STATUS_TRACKING.entries()) {
    if (now - timestamp > WEBHOOK_DEDUPE_WINDOW_MS) {
      RECOVERY_STATUS_TRACKING.delete(trackedKey);
    }
  }

  const existing = RECOVERY_STATUS_TRACKING.get(key);
  if (existing && now - existing <= WEBHOOK_DEDUPE_WINDOW_MS) {
    return true; // Ya se envió dentro de la ventana → duplicado.
  }

  RECOVERY_STATUS_TRACKING.set(key, now);
  return false;
};

const setMessageTracking = (
  dedupeKey: string,
  status: RecoveryStatus,
  attempts: number,
  lastError?: string
) => {
  MESSAGE_TRACKER.set(dedupeKey, {
    status,
    attempts,
    lastError,
    updatedAt: Date.now()
  });
};

const mapStatusToPersistence = (status: RecoveryStatus): PersistedRecoveryStatus => {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'duplicate':
      return 'duplicate';
    case 'skipped':
      return 'skipped';
    default:
      return 'queued';
  }
};

const persistRecoveryState = (input: {
  dedupeKey: string;
  status: RecoveryStatus;
  attempts?: number;
  phone?: string | null;
  customerName?: string | null;
  checkoutUrl?: string | null;
  lastError?: string;
  sentAt?: Date;
}) => {
  void recordRecoveryEvent({
    dedupeKey: input.dedupeKey,
    status: mapStatusToPersistence(input.status),
    attempts: input.attempts,
    phone: input.phone,
    customerName: input.customerName,
    checkoutUrl: input.checkoutUrl,
    lastError: input.lastError,
    sentAt: input.sentAt
  });
};

const persistRecoveryLog = (input: {
  dedupeKey: string;
  level: 'info' | 'warn' | 'error';
  stage: string;
  message: string;
  payload?: Record<string, unknown>;
}) => {
  void appendRecoveryLog({
    dedupeKey: input.dedupeKey,
    level: input.level,
    stage: input.stage,
    message: input.message,
    payload: input.payload
  });
};

const runQueueWorker = async () => {
  if (isQueueWorkerRunning) {
    return;
  }

  isQueueWorkerRunning = true;

  try {
    while (WA_TASK_QUEUE.length > 0) {
      const nextTask = WA_TASK_QUEUE.shift();
      if (!nextTask) {
        break;
      }

      await nextTask();
    }
  } finally {
    isQueueWorkerRunning = false;
  }
};

const enqueueWhatsAppTask = (task: () => Promise<void>) => {
  WA_TASK_QUEUE.push(task);

  if (!isQueueAlertActive && WA_TASK_QUEUE.length > QUEUE_ALERT_THRESHOLD) {
    isQueueAlertActive = true;
    console.error(
      `[QUEUE] 🚨 Cola sobre umbral (${WA_TASK_QUEUE.length}). Revisa conexión de WhatsApp o estado de Baileys.`
    );
    persistRecoveryLog({
      dedupeKey: 'system_queue_alert',
      level: 'error',
      stage: 'queue_threshold_exceeded',
      message: 'La cola de WhatsApp superó el umbral configurado',
      payload: {
        pendingTasks: WA_TASK_QUEUE.length,
        threshold: QUEUE_ALERT_THRESHOLD
      }
    });
  }

  void runQueueWorker();
};

const scheduleWhatsAppSend = (
  dedupeKey: string,
  numeroLimpio: string,
  mensaje: string,
  attempt = 1
) => {
  enqueueWhatsAppTask(async () => {
    try {
      await enviarMensajeWhatsApp(numeroLimpio, mensaje);
      setMessageTracking(dedupeKey, 'sent', attempt);
      persistRecoveryState({
        dedupeKey,
        status: 'sent',
        attempts: attempt,
        phone: numeroLimpio,
        sentAt: new Date()
      });
      persistRecoveryLog({
        dedupeKey,
        level: 'info',
        stage: 'send_success',
        message: `Mensaje enviado correctamente en intento ${attempt}`
      });
      console.log(`[QUEUE] ✅ Envío exitoso para ${dedupeKey} (intento ${attempt}).`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessageTracking(dedupeKey, 'failed', attempt, errorMessage);
      persistRecoveryState({
        dedupeKey,
        status: 'failed',
        attempts: attempt,
        phone: numeroLimpio,
        lastError: errorMessage
      });
      persistRecoveryLog({
        dedupeKey,
        level: 'error',
        stage: 'send_failed',
        message: `Error enviando mensaje en intento ${attempt}`,
        payload: { error: errorMessage }
      });
      console.error(`[QUEUE] ❌ Error en ${dedupeKey} (intento ${attempt}): ${errorMessage}`);

      if (attempt < WA_MAX_ATTEMPTS) {
        const retryDelayMs = attempt * WA_RETRY_BASE_DELAY_MS;
        persistRecoveryLog({
          dedupeKey,
          level: 'warn',
          stage: 'retry_scheduled',
          message: `Reintento programado para intento ${attempt + 1}`,
          payload: { retryDelayMs }
        });
        setTimeout(() => {
          scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensaje, attempt + 1);
        }, retryDelayMs);
      }
    }
  });
};

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = Buffer.from(buf);
    }
  })
);

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send('👑 El Oráculo de VITTOSTORE está en línea y operando.');
});

app.get('/health', (_req: Request, res: Response) => {
  const wa = getWhatsAppHealth();
  const persistence = getRecoveryStoreHealth();
  const tracked = Array.from(MESSAGE_TRACKER.values());
  const sentCount = tracked.filter((item) => item.status === 'sent').length;
  const failedCount = tracked.filter((item) => item.status === 'failed').length;
  const duplicateCount = tracked.filter((item) => item.status === 'duplicate').length;
  const skippedCount = tracked.filter((item) => item.status === 'skipped').length;

  res.status(200).json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    whatsapp: wa,
    persistence,
    recoveryTrackedKeys: RECOVERY_STATUS_TRACKING.size,
    queue: {
      pendingTasks: WA_TASK_QUEUE.length,
      workerRunning: isQueueWorkerRunning,
      alertActive: isQueueAlertActive,
      alertThreshold: QUEUE_ALERT_THRESHOLD
    },
    tracking: {
      trackedKeys: MESSAGE_TRACKER.size,
      sent: sentCount,
      failed: failedCount,
      duplicate: duplicateCount,
      skipped: skippedCount
    },
    config: {
      checkoutUrlLuxury: CHECKOUT_URL_LUXURY,
      abandonedCheckoutTimeoutS: ABANDONED_CHECKOUT_TIMEOUT_S,
      whatsappApiEndpoint: WHATSAPP_API_ENDPOINT,
      waRetryBaseDelayMs: WA_RETRY_BASE_DELAY_MS,
      queueAlertThreshold: QUEUE_ALERT_THRESHOLD
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/webhooks/shopify/checkout', (req: Request, res: Response) => {
  try {
    if (!hasValidShopifyHmac(req as RequestWithRawBody)) {
      console.error('[Security] ❌ Firma HMAC inválida para webhook de Shopify.');
      return res.status(401).send('Firma de webhook inválida');
    }

    const body = req.body;

    const firstName = body?.customer?.first_name || 'Cliente';
    const phone = body?.customer?.phone || body?.shipping_address?.phone || null;
    const recoveryUrlRaw = body?.abandoned_checkout_url;
    const recoveryUrl = isValidRecoveryUrl(recoveryUrlRaw) ? String(recoveryUrlRaw).trim() : null;
    const dedupeKey = String(
      body?.id ||
      body?.token ||
      body?.checkout_token ||
      body?.abandoned_checkout_url ||
      `${phone || 'no-phone'}:${body?.updated_at || body?.created_at || Date.now()}`
    );

    persistRecoveryLog({
      dedupeKey,
      level: 'info',
      stage: 'webhook_received',
      message: 'Webhook de carrito abandonado recibido',
      payload: {
        phone,
        firstName,
        recoveryUrlRaw,
        totalPrice: body?.total_price ?? null
      }
    });

    console.log('==============================');
    console.log('🛒 Webhook de carrito abandonado recibido:');
    console.log(`👤 Cliente: ${firstName}`);
    console.log(`📱 Teléfono detectado: ${phone}`);
    console.log(`🔗 Recovery URL recibida: ${recoveryUrlRaw || 'N/A'}`);
    if (!recoveryUrl) {
      console.log('⚠️ Recovery URL inválida o de prueba. Se enviará mensaje sin link.');
    }
    console.log(`🧩 Dedupe key: ${dedupeKey}`);
    console.log('==============================');

    if (phone && body?.total_price !== '0.00') {
      if (markAndCheckDuplicate(dedupeKey)) {
        setMessageTracking(dedupeKey, 'duplicate', 0, 'Webhook duplicado');
        persistRecoveryState({
          dedupeKey,
          status: 'duplicate',
          attempts: 0,
          phone,
          customerName: firstName,
          checkoutUrl: recoveryUrl ?? CHECKOUT_URL_LUXURY,
          lastError: 'Webhook duplicado'
        });
        persistRecoveryLog({
          dedupeKey,
          level: 'warn',
          stage: 'dedupe_duplicate',
          message: 'Webhook duplicado ignorado'
        });
        console.log('♻️ Webhook duplicado detectado dentro de la ventana. No se reenvía WhatsApp.');
        return res.status(200).send('Webhook duplicado ignorado');
      }

      const numeroLimpio = normalizePhone(phone);

      if (!isValidPhoneForWhatsApp(numeroLimpio)) {
        setMessageTracking(dedupeKey, 'skipped', 0, 'Numero invalido');
        persistRecoveryState({
          dedupeKey,
          status: 'skipped',
          attempts: 0,
          phone: numeroLimpio,
          customerName: firstName,
          checkoutUrl: recoveryUrl ?? CHECKOUT_URL_LUXURY,
          lastError: 'Numero invalido'
        });
        persistRecoveryLog({
          dedupeKey,
          level: 'warn',
          stage: 'phone_invalid',
          message: 'Numero invalido para WhatsApp; se omite envio',
          payload: { numeroLimpio }
        });
        console.log(`⚠️ Número inválido para WhatsApp. Se omite envío: ${numeroLimpio}`);
        return res.status(200).send('Webhook procesado (numero invalido)');
      }

      // Usa la URL dinámica de Shopify si es válida; si no, cae al permalink de lujo.
      const checkoutUrl = recoveryUrl ?? CHECKOUT_URL_LUXURY;
      console.log(`🛒 URL de checkout a enviar: ${checkoutUrl}`);

      const mensaje = MESSAGE_TEMPLATE(firstName, checkoutUrl);

      setMessageTracking(dedupeKey, 'queued', 0);
      persistRecoveryState({
        dedupeKey,
        status: 'queued',
        attempts: 0,
        phone: numeroLimpio,
        customerName: firstName,
        checkoutUrl
      });
      persistRecoveryLog({
        dedupeKey,
        level: 'info',
        stage: 'message_queued',
        message: 'Mensaje encolado para envio',
        payload: { numeroLimpio, checkoutUrl }
      });
      scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensaje);
      console.log(`[QUEUE] 📨 Mensaje encolado para ${dedupeKey}. Cola actual: ${WA_TASK_QUEUE.length}`);

      return res.status(200).send('Webhook aceptado para envio');
    } else {
      setMessageTracking(dedupeKey, 'skipped', 0, 'Sin numero o carrito de prueba');
      persistRecoveryState({
        dedupeKey,
        status: 'skipped',
        attempts: 0,
        phone,
        customerName: firstName,
        checkoutUrl: recoveryUrl ?? CHECKOUT_URL_LUXURY,
        lastError: 'Sin numero o carrito de prueba'
      });
      persistRecoveryLog({
        dedupeKey,
        level: 'warn',
        stage: 'message_skipped',
        message: 'No se envio WhatsApp por falta de numero o total 0',
        payload: {
          hasPhone: Boolean(phone),
          totalPrice: body?.total_price ?? null
        }
      });
      console.log('⚠️ No se envió WhatsApp (Falta número o es un carrito de prueba de $0).');
    }

    return res.status(200).send('Webhook procesado');
  } catch (error) {
    console.error('[Oráculo] Error procesando webhook:', error);
    return res.status(500).send('Error interno');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 El Oráculo de VITTOSTORE está escuchando en el puerto ${PORT}`);
});