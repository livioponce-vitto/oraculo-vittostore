var ContingencyService = (function () {
  function getSheet() {
    return LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY);
  }

  function getRunbookForIntegration(integrationName) {
    var normalized = String(integrationName || '').toUpperCase();
    if (normalized === 'GEMINI') {
      return 'Incidente A - Falla Gemini o extraccion invalida';
    }
    if (normalized === 'FX_API') {
      return 'Incidente B - Caida API tipo de cambio (mindicador)';
    }
    if (normalized === 'MAILAPP') {
      return 'Incidente C - Falla envio de correo (MailApp)';
    }
    if (normalized === 'BANK_RECONCILIATION') {
      return 'Incidente D - Conciliacion bancaria no cuadra';
    }
    if (normalized === 'GMAIL_INGESTION') {
      return 'Incidente A - Falla Gemini o extraccion invalida';
    }
    if (normalized === 'CALENDAR') {
      return 'Revisar permisos CalendarApp y fallback operativo manual';
    }
    return 'Revisar Playbook de Incidentes - VittoStore Finance Automation';
  }

  function classifySeverity(integrationName, fallbackApplied) {
    var normalized = String(integrationName || '').toUpperCase();
    if (fallbackApplied) {
      return 'SEV-3';
    }
    if (normalized === 'FX_API' || normalized === 'GMAIL_INGESTION' || normalized === 'GEMINI') {
      return 'SEV-2';
    }
    if (normalized === 'CALENDAR' || normalized === 'MAILAPP') {
      return 'SEV-3';
    }
    return 'SEV-4';
  }

  function getDefaultNextAction(integrationName, fallbackApplied) {
    var normalized = String(integrationName || '').toUpperCase();
    if (normalized === 'GEMINI') {
      return 'Priorizar XML DTE y reprocesar cuando Gemini vuelva a responder.';
    }
    if (normalized === 'FX_API') {
      return fallbackApplied ? 'Monitorear retorno de mindicador y mantener trazabilidad en AlertaSistema.' : 'Reintentar tipo de cambio y validar cache disponible.';
    }
    if (normalized === 'GMAIL_INGESTION') {
      return 'Revisar mensaje, permisos Gmail y reintentar ingestion manual.';
    }
    if (normalized === 'CALENDAR') {
      return 'Crear recordatorio manual y revisar permisos de CalendarApp.';
    }
    return 'Aplicar runbook y dejar evidencia del workaround.';
  }

  function shouldNotify(severity) {
    return severity === 'SEV-1' || severity === 'SEV-2';
  }

  function registerIntegrationIncident(integrationName, operationName, detail, options) {
    options = options || {};

    var severity = options.severity || classifySeverity(integrationName, options.fallbackApplied);
    var runbook = options.runbook || getRunbookForIntegration(integrationName);
    var nextAction = options.nextAction || getDefaultNextAction(integrationName, options.fallbackApplied);
    var responsible = options.responsible || 'Finanzas';
    var fallbackApplied = options.fallbackApplied ? 'SI' : 'NO';

    getSheet().appendRow([
      FinanceUtils.nowIso(),
      integrationName,
      operationName,
      severity,
      'ABIERTO',
      fallbackApplied,
      runbook,
      detail,
      options.gmailMessageId || '',
      responsible,
      nextAction
    ]);

    if (shouldNotify(severity)) {
      MailApp.sendEmail({
        to: FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS'),
        subject: '[Vitto Finance] ' + severity + ' en integracion ' + integrationName,
        body: [
          'Se detecto una falla de integracion.',
          'Integracion: ' + integrationName,
          'Operacion: ' + operationName,
          'Severidad: ' + severity,
          'Fallback aplicado: ' + fallbackApplied,
          'Detalle: ' + detail,
          'Runbook: ' + runbook,
          'Accion siguiente: ' + nextAction
        ].join('\n')
      });
    }

    AuditService.logWarn('Incidente integracion registrado', JSON.stringify({
      integration: integrationName,
      operation: operationName,
      severity: severity,
      fallbackApplied: fallbackApplied
    }));

    return {
      integration: integrationName,
      operation: operationName,
      severity: severity,
      fallbackApplied: fallbackApplied,
      runbook: runbook,
      nextAction: nextAction
    };
  }

  function runWeeklyIntegrationContingencySummary() {
    var sheet = getSheet();
    var lastRow = sheet.getLastRow();
    var today = FinanceUtils.getChileDate();
    var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    var startDate = new Date(endDate.getTime());
    startDate.setDate(startDate.getDate() - 6);
    var totals = {};
    var rows = [];

    if (lastRow >= 2) {
      rows = sheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY.length).getValues();
    }

    rows.forEach(function (row) {
      var timestamp = new Date(row[0]);
      if (isNaN(timestamp.getTime()) || timestamp < startDate || timestamp > endDate) {
        return;
      }

      var integration = String(row[1] || 'SIN_INTEGRACION');
      totals[integration] = (totals[integration] || 0) + 1;
    });

    var lines = Object.keys(totals).sort().map(function (key) {
      return '- ' + key + ': ' + totals[key];
    });

    MailApp.sendEmail({
      to: FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS'),
      subject: '[Vitto Finance] Resumen semanal de contingencia de integraciones',
      body: [
        'Resumen semanal de incidencias de integracion',
        'Periodo: ' + FinanceUtils.toDateString(startDate) + ' a ' + FinanceUtils.toDateString(endDate),
        '',
        lines.length > 0 ? lines.join('\n') : 'Sin incidentes registrados en el periodo.',
        '',
        'Revisar hoja Contingencia_Integraciones para detalle y acciones.'
      ].join('\n')
    });

    AuditService.logInfo('Resumen semanal contingencia enviado', JSON.stringify({
      periodStart: FinanceUtils.toDateString(startDate),
      periodEnd: FinanceUtils.toDateString(endDate),
      totals: totals
    }));

    return {
      periodStart: FinanceUtils.toDateString(startDate),
      periodEnd: FinanceUtils.toDateString(endDate),
      totals: totals
    };
  }

  return {
    registerIntegrationIncident: registerIntegrationIncident,
    runWeeklyIntegrationContingencySummary: runWeeklyIntegrationContingencySummary
  };
})();
