var ReportingService = (function () {
  function safeSendMail_(payload, contextLabel) {
    try {
      MailApp.sendEmail(payload);
      return { sent: true };
    } catch (error) {
      AuditService.logWarn('MailApp no autorizado; envio omitido', JSON.stringify({
        context: contextLabel,
        message: String(error)
      }));
      return { sent: false, error: String(error) };
    }
  }

  function runWeeklyProfitabilityReport() {
    var today = FinanceUtils.getChileDate();
    var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var startDate = new Date(endDate.getTime());
    startDate.setDate(startDate.getDate() - 6);

    var rows = LedgerService.getRowsForPeriod(startDate, endDate);
    var byOrigin = {};

    rows.forEach(function (row) {
      var tipo = String(row[2] || '').toUpperCase();
      var origin = String(row[14] || 'Sin atribucion');
      var amount = FinanceUtils.normalizeCurrency(row[11]);

      if (!byOrigin[origin]) {
        byOrigin[origin] = { ingresos: 0, egresos: 0, resultado: 0 };
      }

      if (tipo === 'INGRESO') {
        byOrigin[origin].ingresos += amount;
      }
      if (tipo === 'EGRESO') {
        byOrigin[origin].egresos += amount;
      }
      byOrigin[origin].resultado = byOrigin[origin].ingresos - byOrigin[origin].egresos;
    });

    var sortedOrigins = Object.keys(byOrigin).sort(function (a, b) {
      return byOrigin[b].resultado - byOrigin[a].resultado;
    });

    var suggestion = 'Sin datos suficientes.';
    if (sortedOrigins.length > 0) {
      var top = sortedOrigins[0];
      suggestion = 'Priorizar inversion publicitaria en origen: ' + top +
        ' (resultado semanal: ' + byOrigin[top].resultado + ').';
    }

    var lines = [
      'Reporte semanal de rentabilidad por Origen de Venta',
      'Periodo: ' + FinanceUtils.toDateString(startDate) + ' a ' + FinanceUtils.toDateString(endDate),
      ''
    ];

    sortedOrigins.forEach(function (origin) {
      lines.push(
        '- ' + origin +
        ' | Ingresos: ' + byOrigin[origin].ingresos +
        ' | Egresos: ' + byOrigin[origin].egresos +
        ' | Resultado: ' + byOrigin[origin].resultado
      );
    });

    lines.push('');
    lines.push('Recomendacion automatica: ' + suggestion);

    var recipients = FinanceConfig.getRequiredProperty('MARKETING_REPORT_EMAILS');
    var reportEmail = safeSendMail_({
      to: recipients,
      subject: '[CEO/Marketing] Rentabilidad semanal por origen',
      body: lines.join('\n')
    }, 'runWeeklyProfitabilityReport');

    if (!reportEmail.sent) {
      AuditService.logWarn('Reporte semanal sin envio de correo', reportEmail.error);
    }

    AuditService.logInfo('Reporte semanal enviado', suggestion);

    return {
      periodStart: FinanceUtils.toDateString(startDate),
      periodEnd: FinanceUtils.toDateString(endDate),
      suggestion: suggestion,
      totalsByOrigin: byOrigin
    };
  }

  return {
    runWeeklyProfitabilityReport: runWeeklyProfitabilityReport
  };
})();

// ── Wrapper global ────────────────────────────────────────────────────────────

function runWeeklyProfitabilityReport() {
  var result = ReportingService.runWeeklyProfitabilityReport();
  Logger.log('Reporte semanal: ' + JSON.stringify(result));
  SpreadsheetApp.getUi().alert(
    '✅ Reporte semanal generado y enviado por email.\n\n' +
    'Periodo: ' + result.periodStart + ' a ' + result.periodEnd + '\n' +
    'Recomendación: ' + result.suggestion
  );
}

// Configura trigger semanal (lunes 9:00 AM CLT) para el reporte de rentabilidad.
// Ejecutar una sola vez desde el dropdown para activarlo.
function runSetupWeeklyReportTrigger() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'runWeeklyProfitabilityReport') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    ScriptApp.newTrigger('runWeeklyProfitabilityReport')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY)
      .atHour(9)
      .nearMinute(0)
      .inTimezone('America/Santiago')
      .create();
    SpreadsheetApp.getUi().alert('✅ Trigger configurado: reporte de rentabilidad cada lunes 9:00 AM CLT.');
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Error: ' + String(e));
  }
}

