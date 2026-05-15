

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import crypto from 'crypto';
import {
  appendRecoveryLog,
  findRecoveryEventByDedupeKey,
  getRecoveryStoreHealth,
  getPersistedTrackingSnapshot,
  PersistedRecoveryStatus,
  recordRecoveryEvent
} from './recovery-store';
import { enviarMensajeWhatsApp, enviarMensajeWhatsAppModo, getWhatsAppHealth } from './whatsapp';

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

const scheduleWhatsAppSend = (
  dedupeKey: string,
  numeroLimpio: string,
  mensaje: string,
  attempt = 1
) => {
  enqueueWhatsAppTask(async () => {
    try {
      await enviarMensajeWhatsAppModo(numeroLimpio, mensaje, true);

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
          scheduleWhatsAppSend(dedupeKey, numeroLimpio, mensaje, attempt + 1);
        }, delayMs);
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

app.use(cors());
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Endpoint de prueba: POST /test-meta (registrado después de los middlewares)
app.post('/test-meta', async (req, res) => {
  const { numero, mensaje } = req.body;
  if (!numero || !mensaje) {
    return res.status(400).json({ error: 'Faltan parametros: numero y mensaje' });
  }
  try {
    await enviarMensajeWhatsApp(numero, mensaje);
    res.json({ ok: true, numero, mensaje });
  } catch (error) {
    res.status(500).json({ error: error?.toString?.() || 'Error enviando mensaje' });
  }
});

// Endpoint temporal para listar rutas activas
app.get('/routes', (req, res) => {
  const routes: any[] = [];
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      routes.push({
        method: Object.keys(middleware.route.methods)[0].toUpperCase(),
        path: middleware.route.path
      });
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route) {
          routes.push({
            method: Object.keys(handler.route.methods)[0].toUpperCase(),
            path: handler.route.path
          });
        }
      });
    }
  });
  res.json(routes);
});

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

app.post('/webhook', async (req: RequestWithRawBody, res) => {
  try {
    if (!hasValidShopifyHmac(req)) {
      return res.status(401).json({ error: 'Invalid HMAC' });
    }

    const body = req.body;
    if (!body?.checkout) {
      return res.status(400).json({ error: 'No checkout data' });
    }

    const checkoutId = body.checkout.id;
    const customerFirstName = body.checkout.customer?.first_name || 'Cliente';
    const checkoutCreatedAt = body.checkout.created_at ? new Date(body.checkout.created_at).getTime() : Date.now();
    const totalPrice = parseFloat(body.checkout.total_price ?? '0');
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


// Endpoint temporal para listar rutas activas
app.get('/routes', (req, res) => {
  const routes: any[] = [];
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      // routes registered directly on the app
      routes.push({
        method: Object.keys(middleware.route.methods)[0].toUpperCase(),
        path: middleware.route.path
      });
    } else if (middleware.name === 'router') {
      // router middleware 
      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route) {
          routes.push({
            method: Object.keys(handler.route.methods)[0].toUpperCase(),
            path: handler.route.path
          });
        }
      });
    }
  });
  res.json(routes);
});

// ─── INNOV-01: Endpoint de alertas financieras desde Google Apps Script ───────
// Recibe alertas del Libro Mayor y las reenvía por WhatsApp al dueño.
// Autenticado con el header x-finance-alert-token.
const FINANCE_ALERT_TOKEN = process.env.FINANCE_ALERT_TOKEN ?? '';
const FINANCE_ALERT_PHONE = process.env.FINANCE_ALERT_PHONE ?? '';

const ALERT_DEDUP_WINDOW_MS = 55 * 60 * 1000; // 55 min — alineado con silence window de Apps Script
const alertDedupMap = new Map<string, number>();

app.post('/finance-alert', async (req: Request, res: Response) => {
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

app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 Webhook: http://localhost:${PORT}/webhook`);
  console.log(`🔔 Finance alerts: http://localhost:${PORT}/finance-alert\n`);
});