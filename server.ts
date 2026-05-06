import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
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

// ─── ESTADO DE RECUPERACIÓN ───────────────────────────────────────────────────
/**
 * RECOVERY_STATUS_TRACKING: Map en memoria que actúa como registro de envíos.
 * Clave: dedupeKey del checkout. Valor: timestamp del primer envío.
 * Impide reenviar el mensaje al mismo cliente dentro de ABANDONED_CHECKOUT_TIMEOUT_S.
 * En el futuro puedes reemplazar este Map por una tabla en base de datos
 * para persistencia entre reinicios.
 */
const RECOVERY_STATUS_TRACKING = new Map<string, number>();

// ─── APP ──────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const WEBHOOK_DEDUPE_WINDOW_MS = ABANDONED_CHECKOUT_TIMEOUT_S * 1000;

console.log(`[Config] CHECKOUT_URL_LUXURY     = ${CHECKOUT_URL_LUXURY}`);
console.log(`[Config] ABANDONED_CHECKOUT_TIMEOUT_S = ${ABANDONED_CHECKOUT_TIMEOUT_S}s`);
console.log(`[Config] WHATSAPP_API_ENDPOINT   = ${WHATSAPP_API_ENDPOINT}`);

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

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send('👑 El Oráculo de VITTOSTORE está en línea y operando.');
});

app.get('/health', (_req: Request, res: Response) => {
  const wa = getWhatsAppHealth();
  res.status(200).json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    whatsapp: wa,
    recoveryTrackedKeys: RECOVERY_STATUS_TRACKING.size,
    config: {
      checkoutUrlLuxury: CHECKOUT_URL_LUXURY,
      abandonedCheckoutTimeoutS: ABANDONED_CHECKOUT_TIMEOUT_S,
      whatsappApiEndpoint: WHATSAPP_API_ENDPOINT
    },
    timestamp: new Date().toISOString()
  });
});

app.post('/api/webhooks/shopify/checkout', async (req: Request, res: Response) => {
  try {
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

    if (markAndCheckDuplicate(dedupeKey)) {
      console.log('♻️ Webhook duplicado detectado dentro de la ventana. No se reenvía WhatsApp.');
      return res.status(200).send('Webhook duplicado ignorado');
    }

    if (phone && body?.total_price !== '0.00') {
      const numeroLimpio = normalizePhone(phone);

      if (!isValidPhoneForWhatsApp(numeroLimpio)) {
        console.log(`⚠️ Número inválido para WhatsApp. Se omite envío: ${numeroLimpio}`);
        return res.status(200).send('Webhook procesado (numero invalido)');
      }

      // Usa la URL dinámica de Shopify si es válida; si no, cae al permalink de lujo.
      const checkoutUrl = recoveryUrl ?? CHECKOUT_URL_LUXURY;
      console.log(`🛒 URL de checkout a enviar: ${checkoutUrl}`);

      const mensaje = MESSAGE_TEMPLATE(firstName, checkoutUrl);

      await enviarMensajeWhatsApp(numeroLimpio, mensaje);
      
    } else {
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