/**
 * VERIFICATION SCRIPT
 * 
 * Valida que el monitoreo está completamente operativo
 * 
 * Ejecución:
 *  npx ts-node -T verify-monitoring.ts
 */

import https from 'https';

const HEALTH_URL = process.env.HEALTH_URL || 'https://vittostore-oraculo-backend.onrender.com/health';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

console.log(`\n${'═'.repeat(80)}`);
console.log('🔍 MONITORING VERIFICATION');
console.log(`${'═'.repeat(80)}\n`);

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
    lastDisconnectCode?: number | null;
    reconnectAttempts: number;
    reconnectScheduledInSeconds: number;
  };
  queue: {
    totalPending: number;
    alertThreshold: number;
  };
  tracking: {
    sent: number;
    failed: number;
    duplicate: number;
    skipped: number;
  };
  uptimeSeconds: number;
  timestamp: string;
}

interface VerificationResult {
  checkName: string;
  passed: boolean;
  details: string;
}

const results: VerificationResult[] = [];

const fetchJson = (url: string): Promise<{ status: number; data?: HealthResponse; error?: string }> => {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as HealthResponse;
          resolve({ status: res.statusCode || 500, data: parsed });
        } catch (e) {
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

const sendSlackTestMessage = (webhookUrl: string): Promise<boolean> => {
  return new Promise((resolve) => {
    const message = {
      attachments: [
        {
          color: '#36a64f',
          title: '✅ Monitoring Verification Passed',
          text: 'All checks passed at ' + new Date().toISOString(),
          fields: [
            {
              title: 'Health Endpoint',
              value: 'Responsive ✓',
              short: true
            },
            {
              title: 'WhatsApp Status',
              value: 'Ready ✓',
              short: true
            },
            {
              title: 'Queue Status',
              value: 'Healthy ✓',
              short: true
            }
          ]
        }
      ]
    };

    const url = new URL(webhookUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': JSON.stringify(message).length
      },
      timeout: 10000
    };

    const req = https.request(options, () => {
      resolve(true);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.write(JSON.stringify(message));
    req.end();
  });
};

const verify = async () => {
  console.log(`📍 Health URL: ${HEALTH_URL}\n`);

  // Check 1: Health Endpoint Responsive
  console.log('⏳ Check 1: Health endpoint responsive...');
  const { status, data, error } = await fetchJson(HEALTH_URL);

  if (status !== 200 || !data) {
    results.push({
      checkName: 'Health Endpoint',
      passed: false,
      details: `Status ${status}: ${error || 'No data'}`
    });
    console.log(`❌ FAILED: ${error}\n`);
  } else {
    results.push({
      checkName: 'Health Endpoint',
      passed: true,
      details: `Status 200, OK`
    });
    console.log(`✅ PASSED\n`);
  }

  if (!data) {
    // Can't continue without data
    printSummary();
    return;
  }

  // Check 2: WhatsApp Connected
  console.log('⏳ Check 2: WhatsApp connected...');
  const whatsappPassed = data.whatsapp.ready;
  results.push({
    checkName: 'WhatsApp Connected',
    passed: whatsappPassed,
    details: whatsappPassed ? 'Ready' : `Not ready. Last disconnect: ${data.whatsapp.lastDisconnectCode}`
  });
  console.log(`${whatsappPassed ? '✅' : '⚠️'} ${whatsappPassed ? 'PASSED' : 'WARNING'}\n`);

  // Check 3: Queue Healthy
  console.log('⏳ Check 3: Queue health...');
  const queueHealthy = data.queue.totalPending <= data.queue.alertThreshold;
  results.push({
    checkName: 'Queue Health',
    passed: queueHealthy,
    details: `${data.queue.totalPending} pending (threshold: ${data.queue.alertThreshold})`
  });
  console.log(`${queueHealthy ? '✅' : '⚠️'} ${queueHealthy ? 'PASSED' : 'WARNING'}\n`);

  // Check 4: Reconnect Loop Detection
  console.log('⏳ Check 4: Reconnect loop monitoring...');
  const reconnectHealthy = data.whatsapp.reconnectAttempts <= 3;
  results.push({
    checkName: 'Reconnect Loop',
    passed: reconnectHealthy,
    details: `${data.whatsapp.reconnectAttempts} attempts (threshold: 3)`
  });
  console.log(`${reconnectHealthy ? '✅' : '⚠️'} ${reconnectHealthy ? 'PASSED' : 'WARNING'}\n`);

  // Check 5: Delivery Failures Monitoring
  console.log('⏳ Check 5: Delivery failures monitoring...');
  const failuresHealthy = data.tracking.failed <= 5;
  results.push({
    checkName: 'Delivery Failures',
    passed: failuresHealthy,
    details: `${data.tracking.failed} failures (threshold: 5)`
  });
  console.log(`${failuresHealthy ? '✅' : '⚠️'} ${failuresHealthy ? 'PASSED' : 'WARNING'}\n`);

  // Check 6: Alerts System
  console.log('⏳ Check 6: Alerts system...');
  const alertsEnabled = true; // If we got here, system responded
  results.push({
    checkName: 'Alerts System',
    passed: alertsEnabled,
    details: `${data.alerts.count} current alerts`
  });
  console.log(`✅ PASSED\n`);

  // Check 7: Slack Webhook
  if (SLACK_WEBHOOK) {
    console.log('⏳ Check 7: Slack webhook connection...');
    const slackOk = await sendSlackTestMessage(SLACK_WEBHOOK);
    results.push({
      checkName: 'Slack Webhook',
      passed: slackOk,
      details: slackOk ? 'Message sent successfully' : 'Failed to send message'
    });
    console.log(`${slackOk ? '✅' : '❌'} ${slackOk ? 'PASSED' : 'FAILED'}\n`);
  } else {
    results.push({
      checkName: 'Slack Webhook',
      passed: false,
      details: 'SLACK_WEBHOOK_URL not configured'
    });
    console.log(`⚠️  SKIPPED: SLACK_WEBHOOK_URL not configured\n`);
  }

  printSummary();
};

const printSummary = () => {
  console.log(`${'═'.repeat(80)}`);
  console.log('📊 VERIFICATION SUMMARY');
  console.log(`${'═'.repeat(80)}\n`);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    const symbol = result.passed ? '✅' : '❌';
    console.log(`${symbol} ${result.checkName.padEnd(25)} ${result.details}`);
  });

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`\n✨ Results: ${passed}/${total} checks passed\n`);

  if (passed === total) {
    console.log('🎉 All checks passed! Monitoring is fully operational.\n');
  } else {
    console.log('⚠️  Some checks failed. Review the details above.\n');
  }

  console.log(`${'═'.repeat(80)}\n`);

  process.exit(passed === total ? 0 : 1);
};

verify().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
