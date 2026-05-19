

import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  appendRecoveryLog,
  findRecoveryEventByDedupeKey,
  getRecoveryStoreHealth,
  getPersistedTrackingSnapshot,
  PersistedRecoveryStatus,
  recordRecoveryEvent
} from './recovery-store';
import { enviarMensajeWhatsApp, enviarMensajeWhatsAppModo, getWhatsAppHealth, validateWhatsAppToken } from './whatsapp';
import { persistQueueItem, removeQueueItem, loadPersistedQueue } from './queue-store';
import { addToDLQ, getDLQStats, getDLQItems, removeFromDLQ, clearDLQ } from './dlq-store';
import { startWeeklyReport } from './weekly-report';

dotenv.config();

const app = express();
app.use(express.json());



// ─── LOGGING ESTRUCTURADO ──────────────────────────────────────────────────────
type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

const structuredLog = (
  severity: LogSeverity,
  stage: string,
  message: string,
  data?: Record<string, unknown>
) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    severity,
    stage,
    message,
    ...(data && { data })
  };

  console.log(JSON.stringify(logEntry));

  if (process.env.NODE_ENV !== 'production') {
    const severityColor: Record<LogSeverity, string> = {
      DEBUG: '\x1b[36m',
      INFO: '\x1b[32m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      CRITICAL: '\x1b[41m'
    };
    const reset = '\x1b[0m';
    const color = severityColor[severity] || '';
    console.error(`${color}[${severity}] ${timestamp} [${stage}] ${message}${reset}`, data || '');
  }
};

// ─── CONFIGURACIÓN GLOBAL ─────────────────────────────────────────────────────
const CHECKOUT_URL_LUXURY =
  process.env.CHECKOUT_URL_LUXURY ?? 'https://vittostore.store/cart/51578668482848:1';

const ABANDONED_CHECKOUT_TIMEOUT_S =
  Number(process.env.ABANDONED_CHECKOUT_TIMEOUT_S ?? 3600);

const WHATSAPP_API_ENDPOINT =
  process.env.WHATSAPP_API_ENDPOINT ?? 'baileys://local';
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN ?? '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
const WHATSAPP_IS_CLOUD_API = WHATSAPP_API_ENDPOINT.startsWith('https://');
const WA_RETRY_BASE_DELAY_MS = Number(process.env.WA_RETRY_BASE_DELAY_MS ?? 5000);
const QUEUE_ALERT_THRESHOLD = Number(process.env.QUEUE_ALERT_THRESHOLD ?? 20);
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';
const DLQ_ALERT_THRESHOLD = 10;

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

const RECOVERY_STATUS_TRACKING = new Map<string, number>();
const MESSAGE_TRACKER = new Map<string, RecoveryTracking>();
const WA_TASK_QUEUE: Array<() => Promise<void>> = [];
const WA_MAX_ATTEMPTS = 3;
let isQueueWorkerRunning = false;
let isQueueAlertActive = false;

// const app = express(); // Eliminada duplicada
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const WEBHOOK_DEDUPE_WINDOW_MS = ABANDONED_CHECKOUT_TIMEOUT_S * 1000;

console.log(`[Config] CHECKOUT_URL_LUXURY     = ${CHECKOUT_URL_LUXURY}`);
console.log(`[Config] ABANDONED_CHECKOUT_TIMEOUT_S = ${ABANDONED_CHECKOUT_TIMEOUT_S}s`);
console.log(`[Config] WHATSAPP_API_ENDPOINT   = ${WHATSAPP_API_ENDPOINT}`);
console.log(`[Config] WHATSAPP_API_TOKEN set = ${WHATSAPP_API_TOKEN ? 'yes' : 'no'}`);
console.log(`[Config] WHATSAPP_PHONE_NUMBER_ID = ${WHATSAPP_PHONE_NUMBER_ID}`);
console.log(`[Config] WHATSAPP_MODE = ${WHATSAPP_IS_CLOUD_API ? 'Meta Cloud API' : 'Baileys local'}`);
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
    .update(req.rawBody?.toString('utf8') ?? '', 'utf8')
    .digest('base64');

  return digest === hmacHeader;
};

const isValidPhoneForWhatsApp = (phone: string) => /^\d{11,15}$/.test(phone);

// ─── SCHEMAS ZOD ──────────────────────────────────────────────────────────────
const webhookSchema = z.object({
  checkout: z.object({
    id: z.union([z.string(), z.number()]),
    customer: z.object({ first_name: z.string().optional() }).optional(),
    created_at: z.string().optional(),
    total_price: z.union([z.string(), z.number()]).optional(),
    phone: z.string().optional(),
    billing_address: z.object({ phone: z.string().optional() }).optional(),
    abandoned_checkout_url: z.string().optional(),
  }),
});

const financeAlertSchema = z.object({
  phone: z.string().optional(),
  alertType: z.string().max(64).optional(),
  message: z.string().min(1).max(4096),
  sentAt: z.string().optional(),
});

const normalizePhoneNumber = (raw: string) => {
  const cleaned = String(raw || '')
    .replace(/\+/g, '')
    .replace(/\D/g, '')
    .slice(-11);

  return cleaned;
};

const enqueueWhatsAppTask = (task: () => Promise<void>) => {
  WA_TASK_QUEUE.push(task);

  if (WA_TASK_QUEUE.length > QUEUE_ALERT_THRESHOLD) {
    if (!isQueueAlertActive) {
      isQueueAlertActive = true;
      structuredLog(
        'WARN',
        'queue_alert',
        `[QUEUE] 🚨 Cola sobre umbral (${WA_TASK_QUEUE.length}). Revisa conexión de WhatsApp.`,
        {
          queueLength: WA_TASK_QUEUE.length,
          threshold: QUEUE_ALERT_THRESHOLD
        }
      );
      // Solo pasar propiedades válidas
      recordRecoveryEvent({
        dedupeKey: 'queue_alert',
        status: 'queued'
      }).catch(() => {});
    }
  }

  if (!isQueueWorkerRunning) {
    void processWhatsAppQueue();
  }
};

const sendSlackNotification = async (text: string): Promise<void> => {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    structuredLog('WARN', 'slack_notify', 'Error enviando notificación Slack', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
};

const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const auth = req.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

const scheduleWhatsAppSend = (
  dedupeKey: string,
  numeroLimpio: string,
  mensaje: string,
  attempt = 1,
  firstEnqueuedAt = Date.now()
) => {
  persistQueueItem({
    id: dedupeKey,
    phone: numeroLimpio,
    message: mensaje,
    attempt,
    enqueuedAt: Date.now()
  });
  enqueueWhatsAppTask(async () => {
    try {
      await enviarMensajeWhatsAppModo(numeroLimpio, mensaje, true);
      removeQueueItem(dedupeKey);

      let tracking = MESSAGE_TRACKER.get(dedupeKey);
      if (!tracking) {
        tracking = {
          status: 'queued',
          attempts: 0,
          updatedAt: Date.now()
        };
      }
      tracking.status = 'sent';
      tracking.attempts = attempt;
      tracking.updatedAt = Date.now();
      MESSAGE_TRACKER.set(dedupeKey, tracking);

      structuredLog('INFO', 'send_success', 'Mensaje enviado exitosamente', {
        dedupeKey,
        numero: numeroLimpio,
        attempt
      });

      await recordRecoveryEvent({
        dedupeKey,
        status: 'sent'
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      let tracking = MESSAGE_TRACKER.get(dedupeKey);
      if (!tracking) {
        tracking = {
          status: 'queued',
          attempts: 0,
          updatedAt: Date.now()
        };
      }
      const severity: LogSeverity = attempt >= WA_MAX_ATTEMPTS ? 'ERROR' : 'WARN';
      structuredLog(severity, 'send_failed', `Fallo en envío (intento ${attempt}/${WA_MAX_ATTEMPTS})`, {
        dedupeKey,
        numero: numeroLimpio,
        attempt,
        error: errorMsg
      });
      tracking.status = 'failed';
      tracking.attempts = attempt;
      tracking.updatedAt = Date.now();
      MESSAGE_TRACKER.set(dedupeKey, tracking);

      if (attempt < WA_MAX_ATTEMPTS) {
        const delayMs = WA_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        setTimeout(() => {
          scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensaje, attempt + 1, firstEnqueuedAt);
        }, delayMs);
      } else {
        addToDLQ({
          id: dedupeKey,
          phone: numeroLimpio,
          message: mensaje,
          attempts: attempt,
          enqueuedAt: firstEnqueuedAt,
          lastError: errorMsg
        });
        removeQueueItem(dedupeKey);
        const dlqStats = getDLQStats();
        if (dlqStats.count > DLQ_ALERT_THRESHOLD) {
          void sendSlackNotification(
            `🚨 *VittoStore DLQ Alert*: ${dlqStats.count} mensajes en dead-letter queue superan el umbral de ${DLQ_ALERT_THRESHOLD}. Revisar en /admin/dlq`
          );
        }
      }
    }
  });
};

const processWhatsAppQueue = async () => {
  if (isQueueWorkerRunning) {
    return;
  }

  isQueueWorkerRunning = true;

  while (WA_TASK_QUEUE.length > 0) {
    const task = WA_TASK_QUEUE.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        console.error('[Queue] Error:', error);
      }
    }
  }

  isQueueWorkerRunning = false;
  isQueueAlertActive = false;
};

// --- Seguridad HTTP ---
app.use(helmet());

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://vittostore.store,https://admin.shopify.com').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || /\.myshopify\.com$/.test(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS bloqueado: ' + origin));
  },
  credentials: true,
}));

// Rate limit general: 100 req / 15 min
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta mas tarde.' },
}));

// Rate limit estricto para endpoints sensibles
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
});

app.use(
  express.json({
    limit: '256kb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// [SEGURIDAD] /test-meta y /routes eliminados — exponian endpoints internos.

app.get('/health', async (_req, res) => {
  const recoveryHealth = await getRecoveryStoreHealth();
  const wa = getWhatsAppHealth();

  const alerts: string[] = [];

  if ((recoveryHealth as any).databaseConnected === false) {
    alerts.push('DATABASE_DISCONNECTED');
  }

  if (!wa.ready) {
    alerts.push('WHATSAPP_DISCONNECTED');
  }

  if (WA_TASK_QUEUE.length > QUEUE_ALERT_THRESHOLD) {
    alerts.push(`QUEUE_OVERLOAD: ${WA_TASK_QUEUE.length}`);
  }

  res.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    alerts,
    whatsapp: wa,
    queueLength: WA_TASK_QUEUE.length
  });
});

app.post('/webhook', strictLimiter, async (req: RequestWithRawBody, res) => {
  try {
    if (!hasValidShopifyHmac(req)) {
      return res.status(401).json({ error: 'Invalid HMAC' });
    }

    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload invalido', issues: parsed.error.issues });
    }
    const body = parsed.data;

    const checkoutId = body.checkout.id;
    const customerFirstName = body.checkout.customer?.first_name || 'Cliente';
    const checkoutCreatedAt = body.checkout.created_at ? new Date(body.checkout.created_at).getTime() : Date.now();
    const totalPrice = parseFloat(String(body.checkout.total_price ?? '0'));
    const phone = body.checkout.phone || body.checkout.billing_address?.phone || '';
    const statusWhenReceived = body.checkout.abandoned_checkout_url ? 'abandoned' : 'created';
    const now = Date.now();

    const dedupeKey = `${checkoutId}:${statusWhenReceived}`;
    const timeSinceCreation = now - checkoutCreatedAt;

    if (RECOVERY_STATUS_TRACKING.has(dedupeKey)) {
      return res.json({
        status: 'duplicate',
        checkoutId
      });
    }

    const numeroLimpio = normalizePhoneNumber(phone);

    if (!isValidPhoneForWhatsApp(numeroLimpio)) {
      MESSAGE_TRACKER.set(dedupeKey, {
        status: 'skipped',
        attempts: 0,
        updatedAt: Date.now()
      });

      return res.json({
        status: 'skipped',
        reason: 'invalid_phone'
      });
    }

    if (timeSinceCreation < ABANDONED_CHECKOUT_TIMEOUT_S * 1000) {
      const waitMs = ABANDONED_CHECKOUT_TIMEOUT_S * 1000 - timeSinceCreation;

      setTimeout(() => {
        RECOVERY_STATUS_TRACKING.set(dedupeKey, Date.now());
        const mensajeRecuperacion = MESSAGE_TEMPLATE(customerFirstName, CHECKOUT_URL_LUXURY);
        scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensajeRecuperacion);
      }, waitMs);

      return res.json({
        status: 'queued',
        message: `Será enviado en ${Math.round(waitMs / 1000)}s`
      });
    }

    RECOVERY_STATUS_TRACKING.set(dedupeKey, Date.now());
    const mensajeRecuperacion = MESSAGE_TEMPLATE(customerFirstName, CHECKOUT_URL_LUXURY);
    scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensajeRecuperacion);

    await recordRecoveryEvent({
      dedupeKey,
      status: 'queued'
    });

    res.json({
      status: 'queued',
      checkoutId,
      dedupeKey
    });
  } catch (error) {
    console.error('[Webhook] Error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});


// [SEGURIDAD] /routes duplicado eliminado.

// ─── INNOV-01: Endpoint de alertas financieras desde Google Apps Script ───────
// Recibe alertas del Libro Mayor y las reenvía por WhatsApp al dueño.
// Autenticado con el header x-finance-alert-token.
const FINANCE_ALERT_TOKEN = process.env.FINANCE_ALERT_TOKEN ?? '';
const FINANCE_ALERT_PHONE = process.env.FINANCE_ALERT_PHONE ?? '';

const ALERT_DEDUP_WINDOW_MS = 55 * 60 * 1000; // 55 min — alineado con silence window de Apps Script
const alertDedupMap = new Map<string, number>();

app.get('/finance-alert/ping', (_req, res) => {
  res.json({
    endpoint: 'finance-alert',
    tokenConfigured: !!FINANCE_ALERT_TOKEN,
    phoneConfigured: !!FINANCE_ALERT_PHONE,
    deployedAt: '14dff77'
  });
});

app.post('/finance-alert', strictLimiter, async (req: Request, res: Response) => {
  const token = req.get('x-finance-alert-token');

  if (!FINANCE_ALERT_TOKEN || token !== FINANCE_ALERT_TOKEN) {
    structuredLog('WARN', 'finance_alert', 'Token inválido o ausente en /finance-alert');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, alertType, message } = req.body as {
    phone?: string;
    alertType?: string;
    message?: string;
    sentAt?: string;
  };

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Campo message requerido' });
  }

  const targetPhone = phone || FINANCE_ALERT_PHONE;
  if (!targetPhone) {
    return res.status(400).json({ error: 'No hay teléfono destino configurado' });
  }

  // Deduplicación en memoria: misma alerta no se reenvía dentro de la ventana
  const dedupKey = `${alertType ?? 'MANUAL'}::${targetPhone}`;
  const lastSent = alertDedupMap.get(dedupKey);
  if (lastSent && Date.now() - lastSent < ALERT_DEDUP_WINDOW_MS) {
    structuredLog('INFO', 'finance_alert', 'Alerta deduplicada (ya enviada recientemente)', {
      alertType,
      dedupKey,
      minutesAgo: Math.round((Date.now() - lastSent) / 60000)
    });
    return res.json({ status: 'deduplicated', alertType });
  }

  try {
    await enviarMensajeWhatsApp(targetPhone, message);
    alertDedupMap.set(dedupKey, Date.now());

    structuredLog('INFO', 'finance_alert', 'Alerta financiera enviada por WhatsApp', {
      alertType,
      phone: targetPhone,
      messageLength: message.length
    });

    res.json({ status: 'sent', alertType });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    structuredLog('ERROR', 'finance_alert', 'Error enviando alerta financiera', {
      alertType,
      phone: targetPhone,
      error: errorMsg
    });
    res.status(500).json({ error: 'Error enviando mensaje WhatsApp', detail: errorMsg });
  }
});

// ─── ADMIN ROUTES — DLQ ──────────────────────────────────────────────────────
app.get('/admin/dlq', requireAdmin, (_req, res) => {
  res.json(getDLQStats());
});

app.post('/admin/dlq/:id/retry', requireAdmin, (req, res) => {
  const { id } = req.params as { id: string };
  const items = getDLQItems();
  const item = items.find(i => i.id === id);
  if (!item) {
    return res.status(404).json({ error: 'Item no encontrado en DLQ' });
  }
  removeFromDLQ(id);
  scheduleWhatsAppSend(item.id, item.phone, item.message, 1, Date.now());
  structuredLog('INFO', 'dlq_retry', 'Item re-encolado desde DLQ', { id });
  res.json({ status: 'requeued', id });
});

app.delete('/admin/dlq/:id', requireAdmin, (req, res) => {
  const { id } = req.params as { id: string };
  removeFromDLQ(id);
  structuredLog('INFO', 'dlq_delete', 'Item eliminado de DLQ', { id });
  res.json({ status: 'deleted', id });
});

app.delete('/admin/dlq', requireAdmin, (_req, res) => {
  clearDLQ();
  structuredLog('INFO', 'dlq_clear', 'DLQ limpiada completamente');
  res.json({ status: 'cleared' });
});

// Limpia entradas del dedup Map con más de 48h para evitar crecimiento indefinido
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let removed = 0;
  for (const [key, ts] of RECOVERY_STATUS_TRACKING) {
    if (ts < cutoff) {
      RECOVERY_STATUS_TRACKING.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    structuredLog('INFO', 'dedup_cleanup', `Dedup Map: ${removed} entradas expiradas eliminadas`, {
      remaining: RECOVERY_STATUS_TRACKING.size
    });
  }
}, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`🔔 Finance alerts: http://localhost:${PORT}/finance-alert\n`);

  const persisted = loadPersistedQueue();
  if (persisted.length > 0) {
    console.log(`[QueueStore] Reanudando ${persisted.length} mensajes pendientes desde disco`);
    for (const item of persisted) {
      // Restaurar dedup Map para evitar re-envíos si llega un webhook del mismo checkout
      RECOVERY_STATUS_TRACKING.set(item.id, item.enqueuedAt);
      scheduleWhatsAppSend(item.id, item.phone, item.message, item.attempt);
    }
  }

  if (process.env.SLACK_WEBHOOK_URL) {
    startWeeklyReport(process.env.SLACK_WEBHOOK_URL);
    console.log('[WeeklyReport] Scheduled: Mondays 09:00');
  }

  validateWhatsAppToken().then(result => {
    if (result.ok) {
      structuredLog('INFO', 'startup', 'WhatsApp token válido — listo para enviar mensajes');
    } else {
      structuredLog('WARN', 'startup', `WhatsApp no disponible al arrancar: ${result.error}`);
    }
  });
});
