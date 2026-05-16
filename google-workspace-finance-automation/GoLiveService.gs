var GoLiveService = (function () {
  var OPTIONAL_DEFAULTS = {
    GEMINI_MODEL: 'gemini-1.5-pro',
    SHOPIFY_QUERY: 'newer_than:14d -label:FINANCE_PROCESADO_SHOPIFY (subject:(Order OR Pedido) OR from:shopify.com)',
    BILLING_QUERY: 'newer_than:30d -label:FINANCE_PROCESADO_FACTURA (subject:(invoice OR factura OR receipt OR boleta) OR from:(google.com OR openai.com OR aws.amazon.com))'
  };

  function getMissingRequiredProperties() {
    var required = [
      'FINANCE_SPREADSHEET_ID',
      'GEMINI_API_KEY',
      'CEO_EMAIL',
      'FINANCE_ALERT_EMAILS',
      'MARKETING_REPORT_EMAILS',
      'ALLOWED_BILLING_SENDERS',
      'SHOPIFY_ORDER_SENDERS',
      'ALLOWED_TAX_SENDERS',
      'ALLOWED_PATENTES_SENDERS',
      'ALLOWED_BANCARIOS_SENDERS',
      'SIGNATURE_BASE_URL'
    ];

    var props = PropertiesService.getScriptProperties();
    return required.filter(function (k) {
      return !props.getProperty(k);
    });
  }

  function applyOptionalDefaults() {
    var props = PropertiesService.getScriptProperties();
    Object.keys(OPTIONAL_DEFAULTS).forEach(function (key) {
      if (!props.getProperty(key)) {
        props.setProperty(key, OPTIONAL_DEFAULTS[key]);
      }
    });
  }

  function getTriggerHandlers() {
    return ScriptApp.getProjectTriggers().map(function (t) {
      return t.getHandlerFunction();
    });
  }

  function runPreflight() {
    var result = {
      ok: true,
      missingProperties: [],
      triggerHandlers: [],
      checks: []
    };

    applyOptionalDefaults();

    var missing = getMissingRequiredProperties();
    result.missingProperties = missing;
    if (missing.length > 0) {
      result.ok = false;
      result.checks.push('Faltan Script Properties: ' + missing.join(', '));
      return result;
    }

    try {
      FinanceConfig.validateRequiredProperties();
      result.checks.push('Script Properties requeridas: OK');
    } catch (error) {
      result.ok = false;
      result.checks.push('Script Properties requeridas: FAIL - ' + String(error));
      return result;
    }

    try {
      LedgerService.ensureCoreSheets();
      result.checks.push('Estructura de hojas: OK');
    } catch (error2) {
      result.ok = false;
      result.checks.push('Estructura de hojas: FAIL - ' + String(error2));
    }

    try {
      installFinanceTriggers();
      result.triggerHandlers = getTriggerHandlers();
      result.checks.push('Triggers instalados: OK');
    } catch (error3) {
      result.ok = false;
      result.checks.push('Triggers instalados: FAIL - ' + String(error3));
    }

    return result;
  }

  function runSmokeSuite() {
    var smoke = {
      ok: true,
      checks: []
    };

    try {
      var fx = runDailyFxRate();
      smoke.checks.push('FX diario: OK (' + JSON.stringify(fx) + ')');
    } catch (error) {
      smoke.ok = false;
      smoke.checks.push('FX diario: FAIL - ' + String(error));
    }

    try {
      var compliance = runDailyCompliance();
      smoke.checks.push('Compliance diario: OK (' + String(compliance) + ')');
    } catch (error2) {
      smoke.ok = false;
      smoke.checks.push('Compliance diario: FAIL - ' + String(error2));
    }

    try {
      var bank = runWeeklyBankReconciliation();
      smoke.checks.push('Conciliacion bancaria: OK (' + JSON.stringify(bank) + ')');
    } catch (error3) {
      smoke.ok = false;
      smoke.checks.push('Conciliacion bancaria: FAIL - ' + String(error3));
    }

    return smoke;
  }

  function runGoLive() {
    var report = {
      startedAt: FinanceUtils.nowIso(),
      preflight: null,
      smoke: null,
      finalStatus: 'NO_GO'
    };

    var preflight = runPreflight();
    report.preflight = preflight;

    if (!preflight.ok) {
      report.finalStatus = 'NO_GO';
      AuditService.logWarn('GoLive bloqueado por preflight', JSON.stringify(preflight));
      return report;
    }

    var smoke = runSmokeSuite();
    report.smoke = smoke;
    report.finalStatus = smoke.ok ? 'GO_CONDICIONAL' : 'NO_GO';

    AuditService.logInfo('GoLive ejecutado', JSON.stringify(report));
    return report;
  }

  function showPropertySetupTemplate() {
    return {
      FINANCE_SPREADSHEET_ID: 'OBLIGATORIO',
      GEMINI_API_KEY: 'OBLIGATORIO',
      CEO_EMAIL: 'OBLIGATORIO',
      FINANCE_ALERT_EMAILS: 'email1@dominio.com,email2@dominio.com',
      MARKETING_REPORT_EMAILS: 'email1@dominio.com,email2@dominio.com',
      ALLOWED_BILLING_SENDERS: 'google.com,openai.com,aws.amazon.com',
      SHOPIFY_ORDER_SENDERS: 'shopify.com,no-reply@shopify.com',
      ALLOWED_TAX_SENDERS: 'sii.cl',
      ALLOWED_PATENTES_SENDERS: 'gob.cl,municipalidad.cl',
      ALLOWED_BANCARIOS_SENDERS: 'banco.cl,santander.cl,bci.cl',
      SIGNATURE_BASE_URL: 'https://tu-firma.com/aprobar',
      GEMINI_MODEL: OPTIONAL_DEFAULTS.GEMINI_MODEL,
      SHOPIFY_QUERY: OPTIONAL_DEFAULTS.SHOPIFY_QUERY,
      BILLING_QUERY: OPTIONAL_DEFAULTS.BILLING_QUERY
    };
  }

  return {
    runPreflight: runPreflight,
    runSmokeSuite: runSmokeSuite,
    runGoLive: runGoLive,
    showPropertySetupTemplate: showPropertySetupTemplate
  };
})();

function runGoLiveAutomation() {
  return GoLiveService.runGoLive();
}

function runGoLivePreflight() {
  return GoLiveService.runPreflight();
}

function runGoLiveSmokeSuite() {
  return GoLiveService.runSmokeSuite();
}

function showPropertyTemplate() {
  return GoLiveService.showPropertySetupTemplate();
}
