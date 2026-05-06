import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { enviarMensajeWhatsApp, getWhatsAppHealth } from './whatsapp'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const WEBHOOK_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const processedCheckouts = new Map<string, number>();

const normalizePhone = (raw: string) => {
  let cleaned = raw.replace(/\D/g, '');

  if (cleaned.length === 9 && cleaned.startsWith('9')) {
    cleaned = `56${cleaned}`;
    console.log(`🔧 Autocorrección de número aplicada: ${cleaned}`);
  }

  return cleaned;
};

const isValidPhoneForWhatsApp = (phone: string) => /^\d{11,15}$/.test(phone);

const markAndCheckDuplicate = (key: string) => {
  const now = Date.now();

  for (const [processedKey, timestamp] of processedCheckouts.entries()) {
    if (now - timestamp > WEBHOOK_DEDUPE_WINDOW_MS) {
      processedCheckouts.delete(processedKey);
    }
  }

  const existing = processedCheckouts.get(key);
  if (existing && now - existing <= WEBHOOK_DEDUPE_WINDOW_MS) {
    return true;
  }

  processedCheckouts.set(key, now);
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
    dedupeTrackedKeys: processedCheckouts.size,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/webhooks/shopify/checkout', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const firstName = body?.customer?.first_name || 'Cliente';
    const phone = body?.customer?.phone || body?.shipping_address?.phone || null;
    const recoveryUrl = body?.abandoned_checkout_url || 'Sin URL';
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

     // 💣 MUNICIÓN DE CIERRE DE VENTAS
      const mensaje = `¡Hola ${firstName}! 👋 Soy del equipo de VITTOSTORE. 👑

Noté que intentaste realizar una compra, pero el pedido quedó a medias. Como nuestro stock se está moviendo súper rápido hoy, te he separado los artículos de tu carrito por un par de horas para que no te los ganen. ⏳

¿Tuviste algún inconveniente con el método de pago o tienes dudas con el envío? Responde a este mensaje y te ayudo de inmediato. 🤝

Si solo te faltó tiempo, aquí tienes tu enlace seguro para finalizar ahora mismo en menos de 1 minuto:
🛒 ${recoveryUrl}

¡Quedo a tu disposición!`;

      // Disparamos el arma con el número corregido
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