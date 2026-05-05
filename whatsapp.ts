import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

// Inicializamos el bot forzándolo a usar tu Google Chrome real
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

whatsappClient.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('✅ Módulo de WhatsApp conectado y listo para disparar.');
});

whatsappClient.initialize();

export const enviarMensajeWhatsApp = async (numero: string, mensaje: string) => {
    try {
        const chatId = `${numero}@c.us`;
        await whatsappClient.sendMessage(chatId, mensaje);
        console.log(`[WhatsApp] 🚀 Mensaje enviado con éxito a: ${numero}`);
    } catch (error) {
        console.error('[WhatsApp] ❌ Error enviando el mensaje:', error);
    }
};