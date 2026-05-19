import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { loadPersistedQueue } from './queue-store';
import { getDLQStats } from './dlq-store';
import { enviarMensajeWhatsApp } from './whatsapp';

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

type StatusBreakdown = {
  queued: number;
  sent: number;
  failed: number;
  duplicate: number;
  skipped: number;
  total: number;
};

const getWeeklyStats = async (): Promise<StatusBreakdown> => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const breakdown: StatusBreakdown = {
    queued: 0,
    sent: 0,
    failed: 0,
    duplicate: 0,
    skipped: 0,
    total: 0
  };

  if (!prisma) return breakdown;

  try {
    const grouped = await prisma.recoveryEvent.groupBy({
      by: ['status'],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true }
    });

    for (const row of grouped) {
      const key = row.status as keyof Omit<StatusBreakdown, 'total'>;
      if (key in breakdown) {
        breakdown[key] = row._count._all;
      }
      breakdown.total += row._count._all;
    }
  } catch (err) {
    console.error('[WeeklyReport] Error consultando Prisma:', err);
  }

  return breakdown;
};

const buildSlackPayload = (
  stats: StatusBreakdown,
  queueLength: number,
  dlqCount: number,
  dateLabel: string
) => {
  const recoveryRate =
    stats.sent + stats.failed + stats.queued > 0
      ? ((stats.sent / (stats.sent + stats.failed + stats.queued)) * 100).toFixed(1)
      : '0.0';

  const waSuccessRate =
    stats.sent + stats.failed > 0
      ? ((stats.sent / (stats.sent + stats.failed)) * 100).toFixed(1)
      : '0.0';

  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📊 VittoStore Weekly Report' }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Recuperaciones enviadas:*\n${stats.sent}` },
          { type: 'mrkdwn', text: `*Tasa de éxito:*\n${recoveryRate}%` },
          { type: 'mrkdwn', text: `*Entrega WhatsApp:*\n${waSuccessRate}%` },
          { type: 'mrkdwn', text: `*Total eventos:*\n${stats.total}` },
          { type: 'mrkdwn', text: `*Cola pendiente:*\n${queueLength}` },
          { type: 'mrkdwn', text: `*DLQ (fallidos):*\n${dlqCount}` }
        ]
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `VittoStore Oráculo • Semana del ${dateLabel}`
          }
        ]
      }
    ]
  };
};

const buildWhatsAppReport = (
  stats: StatusBreakdown,
  queueLength: number,
  dlqCount: number,
  dateLabel: string
): string => {
  const recoveryRate =
    stats.sent + stats.failed + stats.queued > 0
      ? ((stats.sent / (stats.sent + stats.failed + stats.queued)) * 100).toFixed(1)
      : '0.0';

  return `📊 *Reporte Semanal VittoStore*
Semana del ${dateLabel}

✅ Enviados: ${stats.sent}
❌ Fallidos: ${stats.failed}
🔁 En cola: ${queueLength}
⛔ DLQ: ${dlqCount}
📈 Tasa de éxito: ${recoveryRate}%
📦 Total eventos: ${stats.total}`;
};

/**
 * Schedules a Monday 09:00 cron. Sends to Slack if available, WhatsApp otherwise.
 * Only active when NODE_ENV !== 'test'.
 */
export const startWeeklyReport = (slackWebhookUrl: string, whatsappPhone?: string): void => {
  if (process.env.NODE_ENV === 'test') return;

  cron.schedule('0 9 * * 1', async () => {
    console.log('[WeeklyReport] Generando reporte semanal...');
    try {
      const stats = await getWeeklyStats();
      const queueLength = loadPersistedQueue().length;
      const dlqCount = getDLQStats().count;
      const dateLabel = new Date().toLocaleDateString('es-CL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      if (slackWebhookUrl) {
        const payload = buildSlackPayload(stats, queueLength, dlqCount, dateLabel);
        const response = await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          console.error(`[WeeklyReport] Slack respondió ${response.status}: ${await response.text()}`);
        } else {
          console.log('[WeeklyReport] Reporte semanal enviado a Slack');
          return;
        }
      }

      if (whatsappPhone) {
        const message = buildWhatsAppReport(stats, queueLength, dlqCount, dateLabel);
        await enviarMensajeWhatsApp(whatsappPhone, message);
        console.log('[WeeklyReport] Reporte semanal enviado por WhatsApp');
      }
    } catch (err) {
      console.error('[WeeklyReport] Error enviando reporte semanal:', err);
    }
  });
};
