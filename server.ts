import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { enviarMensajeWhatsApp } from './whatsapp'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send('👑 El Oráculo de VITTOSTORE está en línea y operando.');
});

app.post('/api/webhooks/shopify/checkout', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const firstName = body?.customer?.first_name || 'Cliente';
    const phone = body?.customer?.phone || body?.shipping_address?.phone || null;
    const recoveryUrl = body?.abandoned_checkout_url || 'Sin URL';

    console.log('==============================');
    console.log('🛒 Webhook de carrito abandonado recibido:');
    console.log(`👤 Cliente: ${firstName}`);
    console.log(`📱 Teléfono detectado: ${phone}`);
    console.log('==============================');

    if (phone && body?.total_price !== '0.00') {
      
      let numeroLimpio = phone.replace(/\D/g, ''); 
      
      // 🛡️ PARCHE DE INTELIGENCIA: Agregar código de Chile (56) si el cliente lo omitió
      if (numeroLimpio.length === 9 && numeroLimpio.startsWith('9')) {
         numeroLimpio = '56' + numeroLimpio;
         console.log(`🔧 Autocorrección de número aplicada: ${numeroLimpio}`);
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