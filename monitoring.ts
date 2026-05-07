/**
 * MONITORING SCRIPT
 * 
 * Ejecutar cada 5 minutos via cron job en Render para validar salud del sistema.
 * 
 * En Render:
 * - Settings → Environment → Add cronSchedule env var: "*/5 * * * *" (cada 5 min)
 * - Deploy hook para ejecutar: node --loader ts-node/esm monitoring.ts
 */

import https from 'https';

const HEALTH_ENDPOINT = process.env.HEALTH_URL || 'https://vittostore-oraculo-backend.onrender.com/health';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

interface HealthResponse {
  ok: boolean;
  healthy: boolean;
  alerts: {
    hasAlerts: boolean;
    count: number;
    messages: string[];
  };
  whatsapp: {
    ready: boolean;
    reconnectAttempts: number;
    lastDisconnectCode?: number | null;
  };
  queue: {
    totalPending: number;
    alertThreshold: number;
  };
  tracking: {
    failed: number;
  };
  timestamp: string;
}

interface MonitoringResult {
  timestamp: string;
  checks: {
    queueSaturation: { passed: boolean; value: number; threshold: number };
    whatsappConnected: { passed: boolean; ready: boolean };
    reconnectLoop: { passed: boolean; attempts: number };
    deliveryFailures: { passed: boolean; failed: number };
    endpointResponsive: { passed: boolean; statusCode?: number; error?: string };
  };
  overallHealth: boolean;
  alerts: string[];
}

const fetchHealth = (): Promise<{ status: number; data?: HealthResponse; error?: string }> => {
  return new Promise((resolve) => {
    const url = new URL(HEALTH_ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as HealthResponse;
          resolve({ status: res.statusCode || 500, data: parsed });
        } catch {
          resolve({ status: res.statusCode || 500, error: 'Invalid JSON' });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ status: 0, error: e.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'Timeout' });
    });

    req.end();
  });
};

const sendSlackAlert = async (result: MonitoringResult): Promise<void> => {
  if (!SLACK_WEBHOOK) {
    console.log('[Monitor] No SLACK_WEBHOOK_URL configured; skipping Slack notification');
    return;
  }

  const color = result.overallHealth ? '#36a64f' : '#ff0000';
  const emoji = result.overallHealth ? '✅' : '🚨';

  const payload = {
    attachments: [
      {
        color,
        title: `${emoji} Oráculo Health Check - ${new Date().toISOString()}`,
        fields: [
          {
            title: 'Overall Health',
            value: result.overallHealth ? 'HEALTHY' : 'DEGRADED',
            short: true
          },
          {
            title: 'Queue Saturation',
            value: result.checks.queueSaturation.passed ? '✅ PASS' : `❌ FAIL: ${result.checks.queueSaturation.value}/${result.checks.queueSaturation.threshold}`,
            short: true
          },
          {
            title: 'WhatsApp Connected',
            value: result.checks.whatsappConnected.passed ? '✅ PASS' : '❌ FAIL: Disconnected',
            short: true
          },
          {
            title: 'Reconnect Loop',
            value: result.checks.reconnectLoop.passed ? '✅ PASS' : `❌ FAIL: ${result.checks.reconnectLoop.attempts} attempts`,
            short: true
          },
          {
            title: 'Delivery Failures',
            value: result.checks.deliveryFailures.passed ? '✅ PASS' : `❌ FAIL: ${result.checks.deliveryFailures.failed} failures`,
            short: true
          },
          {
            title: 'Endpoint Responsive',
            value: result.checks.endpointResponsive.passed ? '✅ PASS' : `❌ FAIL: ${result.checks.endpointResponsive.error}`,
            short: true
          }
        ],
        ...(result.alerts.length > 0 && {
          text: `**Alerts:**\n${result.alerts.map((a) => `• ${a}`).join('\n')}`
        })
      }
    ]
  };

  return new Promise((resolve) => {
    const url = new URL(SLACK_WEBHOOK);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': JSON.stringify(payload).length
      },
      timeout: 10000
    };

    const req = https.request(options, () => {
      resolve();
    });

    req.on('error', () => {
      resolve(); // Don't fail the monitor if Slack fails
    });

    req.on('timeout', () => {
      req.destroy();
      resolve();
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
};

const runMonitoringCheck = async (): Promise<void> => {
  console.log(`[Monitor] Starting health check at ${new Date().toISOString()}`);

  const { status, data, error } = await fetchHealth();

  const result: MonitoringResult = {
    timestamp: new Date().toISOString(),
    checks: {
      queueSaturation: {
        passed: false,
        value: 0,
        threshold: 0
      },
      whatsappConnected: {
        passed: false,
        ready: false
      },
      reconnectLoop: {
        passed: false,
        attempts: 0
      },
      deliveryFailures: {
        passed: false,
        failed: 0
      },
      endpointResponsive: {
        passed: status === 200,
        statusCode: status,
        error: error || undefined
      }
    },
    overallHealth: false,
    alerts: []
  };

  if (!data) {
    result.alerts.push(`❌ CRITICAL: Health endpoint not responding. Error: ${error}`);
    result.overallHealth = false;
  } else {
    // Queue Saturation
    const queuePending = data.queue.totalPending;
    const queueThreshold = data.queue.alertThreshold;
    result.checks.queueSaturation = {
      passed: queuePending <= queueThreshold,
      value: queuePending,
      threshold: queueThreshold
    };
    if (!result.checks.queueSaturation.passed) {
      result.alerts.push(`⚠️ QUEUE SATURATED: ${queuePending} pending > threshold ${queueThreshold}`);
    }

    // WhatsApp Connected
    result.checks.whatsappConnected = {
      passed: data.whatsapp.ready,
      ready: data.whatsapp.ready
    };
    if (!result.checks.whatsappConnected.passed) {
      result.alerts.push(`🔴 WHATSAPP DISCONNECTED: Last disconnect code: ${data.whatsapp.lastDisconnectCode}`);
    }

    // Reconnect Loop
    result.checks.reconnectLoop = {
      passed: data.whatsapp.reconnectAttempts <= 3,
      attempts: data.whatsapp.reconnectAttempts
    };
    if (!result.checks.reconnectLoop.passed) {
      result.alerts.push(`🔄 RECONNECT LOOP: ${data.whatsapp.reconnectAttempts} reconnect attempts`);
    }

    // Delivery Failures
    result.checks.deliveryFailures = {
      passed: data.tracking.failed <= 5,
      failed: data.tracking.failed
    };
    if (!result.checks.deliveryFailures.passed) {
      result.alerts.push(`📬 DELIVERY FAILURES: ${data.tracking.failed} failed messages`);
    }

    // Overall Health
    result.overallHealth = !data.alerts.hasAlerts && Object.values(result.checks).every((c) => c.passed);

    if (data.alerts.hasAlerts) {
      result.alerts.push(...data.alerts.messages);
    }
  }

  // Log result
  console.log('[Monitor] Health Check Result:', JSON.stringify(result, null, 2));

  // Send Slack notification if unhealthy
  if (!result.overallHealth) {
    console.log('[Monitor] System health degraded. Sending Slack alert...');
    await sendSlackAlert(result);
  } else {
    console.log('[Monitor] System healthy. No alerts needed.');
  }

  process.exit(result.overallHealth ? 0 : 1);
};

runMonitoringCheck().catch((err) => {
  console.error('[Monitor] Fatal error:', err);
  process.exit(2);
});
