import puppeteer from 'puppeteer';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const executablePath = puppeteer.executablePath();
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
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