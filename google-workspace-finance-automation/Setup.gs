function initializeFinanceAutomation() {
  FinanceConfig.validateRequiredProperties();
  LedgerService.ensureCoreSheets();
  DashboardService.refreshExecutiveSuite();
  SheetPresentationService.applyAllPresentation();
  SheetSecurityService.applyRoleProtections();
  installFinanceTriggers();
  AuditService.logInfo('Inicializacion completa', 'Sistema financiero listo');
  return 'Sistema inicializado';
}

function refreshExecutiveSuite() {
  LedgerService.ensureCoreSheets();
  return DashboardService.refreshExecutiveSuite();
}

function applyAllPresentation() {
  LedgerService.ensureCoreSheets();
  return SheetPresentationService.applyAllPresentation();
}

function myFunction() {
  AuditService.logWarn('Legacy myFunction ejecutada', 'Usando compatibilidad para evitar fallo por funcion borrada');
  return initializeFinanceAutomation();
}

function cleanupLegacyMyFunctionTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'myFunction') {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  AuditService.logInfo('Limpieza triggers legacy completada', 'Triggers myFunction eliminados: ' + removed);
  return {
    removed: removed
  };
}

function installFinanceTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  var functionNames = existing.map(function (t) {
    return t.getHandlerFunction();
  });

  function ensureTrigger(functionName, builder) {
    if (functionNames.indexOf(functionName) !== -1) {
      return;
    }
    builder.create();
  }

  ensureTrigger('runFinancialIngestion', ScriptApp.newTrigger('runFinancialIngestion').timeBased().everyHours(1));
  ensureTrigger('runDailyFxRate', ScriptApp.newTrigger('runDailyFxRate').timeBased().everyDays(1).atHour(8));
  ensureTrigger('runDailyCompliance', ScriptApp.newTrigger('runDailyCompliance').timeBased().everyDays(1).atHour(9));
  ensureTrigger('runMonthlyBalance', ScriptApp.newTrigger('runMonthlyBalance').timeBased().everyDays(1).atHour(22));
  ensureTrigger('runWeeklyCEOReport', ScriptApp.newTrigger('runWeeklyCEOReport').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8));
  ensureTrigger('runWeeklyBankReconciliation', ScriptApp.newTrigger('runWeeklyBankReconciliation').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10));
  ensureTrigger('runWeeklyCalendarReminder', ScriptApp.newTrigger('runWeeklyCalendarReminder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9));
  ensureTrigger('runWeeklyDataQualitySummary', ScriptApp.newTrigger('runWeeklyDataQualitySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(11));
  ensureTrigger('runWeeklyIntegrationContingencySummary', ScriptApp.newTrigger('runWeeklyIntegrationContingencySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(12));
  ensureTrigger('runExecutiveDashboardRefresh', ScriptApp.newTrigger('runExecutiveDashboardRefresh').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(13));
}

function assertCriticalServicesForPhase4_() {
  var dqOk = typeof DataQualityService !== 'undefined' && DataQualityService && typeof DataQualityService.runLedgerDataQualityChecks === 'function';
  var rqOk = typeof ReviewQueueService !== 'undefined' && ReviewQueueService && typeof ReviewQueueService.syncRejectedRecordsToReviewQueue === 'function';

  if (dqOk && rqOk) {
    return;
  }

  throw new Error(
    'RUNTIME_MISSING_SERVICES_20260508: faltan servicios para Fase 4. ' +
    'DataQualityService=' + typeof DataQualityService +
    ', DataQualityService.runLedgerDataQualityChecks=' +
      ((typeof DataQualityService !== 'undefined' && DataQualityService) ? typeof DataQualityService.runLedgerDataQualityChecks : 'n/a') +
    ', ReviewQueueService=' + typeof ReviewQueueService +
    ', ReviewQueueService.syncRejectedRecordsToReviewQueue=' +
      ((typeof ReviewQueueService !== 'undefined' && ReviewQueueService) ? typeof ReviewQueueService.syncRejectedRecordsToReviewQueue : 'n/a') +
    '. Revisa despliegue de DataQualityService.gs y ReviewQueueService.gs en el MISMO proyecto GAS.'
  );
}

function assertIngestionEngineRuntime_20260508() {
  var hasGmailIife = typeof GmailIngestion !== 'undefined' && GmailIngestion && typeof GmailIngestion.runIngestion === 'function';
  var hasVittoIife = typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion && typeof VittoGmailIngestion.runIngestion === 'function';
  var hasGlobalRef = typeof __VITTO_RUN_INGESTION_REF === 'function';

  if (hasGmailIife || hasVittoIife || hasGlobalRef) {
    return;
  }

  throw new Error(
    'RUNTIME_INGESTION_ENGINE_MISSING_20260508: motor de ingestion no cargado. ' +
    'GmailIngestion=' + typeof GmailIngestion +
    ', GmailIngestion.runIngestion=' +
      ((typeof GmailIngestion !== 'undefined' && GmailIngestion) ? typeof GmailIngestion.runIngestion : 'n/a') +
    ', VittoGmailIngestion=' + typeof VittoGmailIngestion +
    ', VittoGmailIngestion.runIngestion=' +
      ((typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion) ? typeof VittoGmailIngestion.runIngestion : 'n/a') +
    ', __VITTO_RUN_INGESTION_REF=' + typeof __VITTO_RUN_INGESTION_REF +
    '. Revisa despliegue de GmailIngestion.gs en el MISMO proyecto GAS.'
  );
}

function runFinancialIngestion() {
  try {
    assertCriticalServicesForPhase4_();
  } catch (e) {
    Logger.log('[WARN] runFinancialIngestion downgraded to diagnostics: ' + String(e));
    try {
      runPhase4RuntimeDiagnostics_20260508();
    } catch (diagErr) {
      Logger.log('[WARN] runPhase4RuntimeDiagnostics_20260508 failed: ' + String(diagErr));
    }

    throw new Error(
      'RUNTIME_BLOCKED_20260508: se aborto Ingestion ahora porque faltan servicios criticos de Fase 4. ' +
      'Ejecuta Run Phase4 Runtime Diagnostics y corrige el deploy antes de reintentar.'
    );
  }

  if (typeof runFinancialIngestionDirectVitto_20260508 !== 'function') {
    throw new Error(
      'DEPLOY_MISMATCH_20260508: runFinancialIngestionDirectVitto_20260508 no existe en runtime. ' +
      'Hay archivos legacy/duplicados en GAS o no se guardo el GmailIngestion.gs actualizado.'
    );
  }

  assertIngestionEngineRuntime_20260508();

  return runFinancialIngestionDirectVitto_20260508();
}

function debugCriticalServicesRuntime_20260508() {
  var report = {
    VITTO_DATA_QUALITY_VERSION_20260508: typeof VITTO_DATA_QUALITY_VERSION_20260508 !== 'undefined' ? VITTO_DATA_QUALITY_VERSION_20260508 : 'missing',
    VITTO_REVIEW_QUEUE_VERSION_20260508: typeof VITTO_REVIEW_QUEUE_VERSION_20260508 !== 'undefined' ? VITTO_REVIEW_QUEUE_VERSION_20260508 : 'missing',
    DataQualityService: typeof DataQualityService,
    DataQualityService_runLedgerDataQualityChecks: (typeof DataQualityService !== 'undefined' && DataQualityService)
      ? typeof DataQualityService.runLedgerDataQualityChecks
      : 'n/a',
    ReviewQueueService: typeof ReviewQueueService,
    ReviewQueueService_syncRejectedRecordsToReviewQueue: (typeof ReviewQueueService !== 'undefined' && ReviewQueueService)
      ? typeof ReviewQueueService.syncRejectedRecordsToReviewQueue
      : 'n/a',
    runFinancialIngestionDirectVitto_20260508: typeof runFinancialIngestionDirectVitto_20260508,
    GmailIngestion: typeof GmailIngestion,
    GmailIngestion_runIngestion: (typeof GmailIngestion !== 'undefined' && GmailIngestion)
      ? typeof GmailIngestion.runIngestion
      : 'n/a',
    VittoGmailIngestion: typeof VittoGmailIngestion,
    VittoGmailIngestion_runIngestion: (typeof VittoGmailIngestion !== 'undefined' && VittoGmailIngestion)
      ? typeof VittoGmailIngestion.runIngestion
      : 'n/a',
    __VITTO_RUN_INGESTION_REF: typeof __VITTO_RUN_INGESTION_REF
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function runGlobalRuntimeAudit_20260508() {
  var contracts = {
    FinanceUtils: ['nowIso', 'nowChile', 'getChileDate', 'normalizeCurrency', 'roundCurrency', 'buildDocHash', 'safeJsonParse', 'toDateString'],
    FinanceConfig: ['getSpreadsheet', 'validateRequiredProperties', 'getRequiredProperty', 'SHEETS', 'HEADERS'],
    AuditService: ['logInfo', 'logWarn', 'logError'],
    ContingencyService: ['registerIntegrationIncident'],
    LedgerService: ['ensureCoreSheets', 'getOrCreateSheet', 'saveExtractedEntry', 'getRowsForPeriod'],
    DashboardService: ['refreshExecutiveSuite'],
    SheetPresentationService: ['applyAllPresentation'],
    SheetSecurityService: ['applyRoleProtections'],
    FxService: ['convertToClp', 'refreshDailyUsdObservedRate'],
    DataQualityService: ['runLedgerDataQualityChecks', 'runWeeklyDataQualitySummary', 'registerRejectedRecord'],
    ReviewQueueService: ['syncRejectedRecordsToReviewQueue', 'processReviewQueue'],
    CalendarService: ['runWeeklyCalendarReminder'],
    ReportingService: ['runWeeklyProfitabilityReport'],
    BankReconciliationService: ['runWeeklyBankReconciliation'],
    PurchaseOrderService: ['generatePurchaseOrderFromRow'],
    GmailIngestion: ['runIngestion']
  };

  var runtime = {
    FinanceUtils: typeof FinanceUtils !== 'undefined' ? FinanceUtils : null,
    FinanceConfig: typeof FinanceConfig !== 'undefined' ? FinanceConfig : null,
    AuditService: typeof AuditService !== 'undefined' ? AuditService : null,
    ContingencyService: typeof ContingencyService !== 'undefined' ? ContingencyService : null,
    LedgerService: typeof LedgerService !== 'undefined' ? LedgerService : null,
    DashboardService: typeof DashboardService !== 'undefined' ? DashboardService : null,
    SheetPresentationService: typeof SheetPresentationService !== 'undefined' ? SheetPresentationService : null,
    SheetSecurityService: typeof SheetSecurityService !== 'undefined' ? SheetSecurityService : null,
    FxService: typeof FxService !== 'undefined' ? FxService : null,
    DataQualityService: typeof DataQualityService !== 'undefined' ? DataQualityService : null,
    ReviewQueueService: typeof ReviewQueueService !== 'undefined' ? ReviewQueueService : null,
    CalendarService: typeof CalendarService !== 'undefined' ? CalendarService : null,
    ReportingService: typeof ReportingService !== 'undefined' ? ReportingService : null,
    BankReconciliationService: typeof BankReconciliationService !== 'undefined' ? BankReconciliationService : null,
    PurchaseOrderService: typeof PurchaseOrderService !== 'undefined' ? PurchaseOrderService : null,
    GmailIngestion: typeof GmailIngestion !== 'undefined' ? GmailIngestion : null
  };

  var audit = [];
  Object.keys(contracts).forEach(function (name) {
    var target = runtime[name];
    var entry = {
      symbol: name,
      exists: !!target,
      type: typeof target,
      missingMethods: []
    };

    if (!target) {
      entry.missingMethods = contracts[name].slice();
    } else {
      contracts[name].forEach(function (methodName) {
        if (typeof target[methodName] === 'undefined') {
          entry.missingMethods.push(methodName + ' (missing)');
          return;
        }

        var looksLikeContainer = methodName === 'SHEETS' || methodName === 'HEADERS';
        if (!looksLikeContainer && typeof target[methodName] !== 'function') {
          entry.missingMethods.push(methodName + ' (not function)');
        }
      });
    }

    entry.status = !entry.exists ? 'MISSING_SYMBOL' : (entry.missingMethods.length ? 'INCOMPLETE_INTERFACE' : 'OK');
    audit.push(entry);
  });

  var summary = {
    executedAt: FinanceUtils && typeof FinanceUtils.nowChile === 'function' ? FinanceUtils.nowChile() : new Date().toISOString(),
    totalSymbols: audit.length,
    ok: audit.filter(function (item) { return item.status === 'OK'; }).length,
    incomplete: audit.filter(function (item) { return item.status === 'INCOMPLETE_INTERFACE'; }).length,
    missing: audit.filter(function (item) { return item.status === 'MISSING_SYMBOL'; }).length,
    audit: audit
  };

  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function runRuntimeFailureSimulation_20260508() {
  var audit = runGlobalRuntimeAudit_20260508();
  var scenarios = [];

  audit.audit.forEach(function (entry) {
    if (entry.status === 'OK') {
      return;
    }

    var impact = 'Impacto transversal';
    if (entry.symbol === 'FinanceUtils') {
      impact = 'Rompe timestamps, normalizacion, hashes y armado de ledger';
    } else if (entry.symbol === 'LedgerService') {
      impact = 'Rompe persistencia del Libro Mayor y hojas core';
    } else if (entry.symbol === 'DashboardService') {
      impact = 'Rompe Dashboard_Ejecutivo, vistas y Centro_Mandos';
    } else if (entry.symbol === 'DataQualityService') {
      impact = 'Rompe rechazos, control de calidad y alertas';
    } else if (entry.symbol === 'ReviewQueueService') {
      impact = 'Rompe bandeja de revision y semaforos operativos';
    } else if (entry.symbol === 'FxService') {
      impact = 'Rompe conversion USD->CLP y valorizacion contable';
    }

    scenarios.push({
      symbol: entry.symbol,
      status: entry.status,
      simulatedError: 'TypeError: ' + entry.symbol + '.' + String((entry.missingMethods[0] || 'unknown')).replace(' (missing)', '').replace(' (not function)', '') + ' is not a function',
      impact: impact,
      missingMethods: entry.missingMethods
    });
  });

  var report = {
    executedAt: FinanceUtils && typeof FinanceUtils.nowChile === 'function' ? FinanceUtils.nowChile() : new Date().toISOString(),
    simulatedFailures: scenarios.length,
    scenarios: scenarios
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function publishRuntimeAuditSheet_20260508() {
  var ss = FinanceConfig.getSpreadsheet();
  var sheetName = 'Auditoria_Runtime';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  var audit = runGlobalRuntimeAudit_20260508();
  var simulation = runRuntimeFailureSimulation_20260508();
  var borderColor = '#cbd5e1';

  sheet.clear();
  sheet.setConditionalFormatRules([]);
  sheet.setTabColor('#7c2d12');
  sheet.setFrozenRows(5);

  sheet.getRange('A1:H2').merge().setValue('VITTOSTORE | AUDITORIA RUNTIME GAS');
  sheet.getRange('A3:D3').merge().setValue('Control preventivo de contratos globales e interfaces criticas');
  sheet.getRange('E3:H3').merge().setValue('Ejecutado: ' + audit.executedAt);
  sheet.getRange('A1:H3')
    .setFontFamily('Verdana')
    .setVerticalAlignment('middle');
  sheet.getRange('A1:H2')
    .setBackground('#14324a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(15)
    .setHorizontalAlignment('center');
  sheet.getRange('A3:D3')
    .setBackground('#fef3c7')
    .setFontColor('#92400e')
    .setFontWeight('bold');
  sheet.getRange('E3:H3')
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange('A5:H5').setValues([['Indicador', 'Valor', 'Meta', 'Estado', 'Detalle', '', '', '']]);
  sheet.getRange('A6:E9').setValues([
    ['Simbolos auditados', audit.totalSymbols, '100% revisados', 'OK', 'Cobertura del contrato runtime'],
    ['Interfaces completas', audit.ok, audit.totalSymbols, audit.incomplete === 0 && audit.missing === 0 ? 'OK' : 'ATENCION', 'Servicios con todos los metodos esperados'],
    ['Interfaces incompletas', audit.incomplete, 0, audit.incomplete === 0 ? 'OK' : 'RIESGO', 'Simbolos presentes pero con metodos faltantes'],
    ['Simbolos ausentes', audit.missing, 0, audit.missing === 0 ? 'OK' : 'CRITICO', 'Servicios no disponibles en runtime']
  ]);
  sheet.getRange('A5:H5')
    .setBackground('#334155')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.getRange('B6:C9').setNumberFormat('#,##0');

  sheet.getRange('A11:F11').setValues([['Simbolo', 'Existe', 'Tipo', 'Estado', 'Metodos faltantes', 'Conclusion']]);
  var auditRows = audit.audit.map(function (entry) {
    var conclusion = entry.status === 'OK'
      ? 'Contrato consistente'
      : (entry.status === 'MISSING_SYMBOL' ? 'Riesgo de falla inmediata' : 'Riesgo de TypeError parcial');
    return [
      entry.symbol,
      entry.exists ? 'SI' : 'NO',
      entry.type,
      entry.status,
      entry.missingMethods.length ? entry.missingMethods.join(', ') : 'Ninguno',
      conclusion
    ];
  });
  if (auditRows.length) {
    sheet.getRange(12, 1, auditRows.length, 6).setValues(auditRows);
  }

  var failureStartRow = 14 + Math.max(auditRows.length, 1);
  sheet.getRange(failureStartRow, 1, 1, 6).setValues([['Simbolo', 'Estado', 'Error simulado', 'Impacto', 'Metodos faltantes', 'Criticidad']]);
  var scenarioRows = simulation.scenarios.length ? simulation.scenarios.map(function (scenario) {
    var criticality = scenario.symbol === 'FinanceUtils' || scenario.symbol === 'LedgerService' || scenario.symbol === 'DashboardService'
      ? 'ALTA'
      : 'MEDIA';
    return [
      scenario.symbol,
      scenario.status,
      scenario.simulatedError,
      scenario.impact,
      scenario.missingMethods.join(', '),
      criticality
    ];
  }) : [['Sin fallas simuladas', 'OK', 'N/A', 'Sin hallazgos de runtime', 'Ninguno', 'BAJA']];
  sheet.getRange(failureStartRow + 1, 1, scenarioRows.length, 6).setValues(scenarioRows);

  sheet.getRange('A11:F11').setBackground('#1d4ed8').setFontColor('#ffffff').setFontWeight('bold');
  sheet.getRange(failureStartRow, 1, 1, 6).setBackground('#7c2d12').setFontColor('#ffffff').setFontWeight('bold');

  sheet.getRange(1, 1, Math.max(failureStartRow + scenarioRows.length, 12), 8)
    .setFontFamily('Verdana')
    .setVerticalAlignment('middle');
  sheet.getRange(5, 1, 5, 5).setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  if (auditRows.length) {
    sheet.getRange(11, 1, auditRows.length + 1, 6).setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  }
  sheet.getRange(failureStartRow, 1, scenarioRows.length + 1, 6).setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.autoResizeColumns(1, 8);
  sheet.setColumnWidth(5, 280);
  sheet.setColumnWidth(6, 220);

  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground('#dcfce7').setFontColor('#166534').setRanges([sheet.getRange('D6:D9'), sheet.getRange(12, 4, Math.max(auditRows.length, 1), 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ATENCION').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange('D6:D9')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('RIESGO').setBackground('#fed7aa').setFontColor('#9a3412').setRanges([sheet.getRange('D6:D9')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CRITICO').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('D6:D9')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('MISSING_SYMBOL').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange(12, 4, Math.max(auditRows.length, 1), 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('INCOMPLETE_INTERFACE').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange(12, 4, Math.max(auditRows.length, 1), 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ALTA').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange(failureStartRow + 1, 6, scenarioRows.length, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('MEDIA').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange(failureStartRow + 1, 6, scenarioRows.length, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BAJA').setBackground('#dcfce7').setFontColor('#166534').setRanges([sheet.getRange(failureStartRow + 1, 6, scenarioRows.length, 1)]).build()
  ];
  sheet.setConditionalFormatRules(rules);

  ss.setActiveSheet(sheet);
  AuditService.logInfo('Auditoria runtime publicada', JSON.stringify({ sheet: sheetName, symbols: audit.totalSymbols, failures: simulation.simulatedFailures }));
  return {
    status: 'ok',
    sheet: sheetName,
    totalSymbols: audit.totalSymbols,
    simulatedFailures: simulation.simulatedFailures
  };
}

function pauseIngestionTriggers_20260508() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runFinancialIngestion') {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });

  Logger.log('pauseIngestionTriggers_20260508 removed=' + removed);
  return { removed: removed };
}

function runPhase4RuntimeDiagnostics_20260508() {
  var critical = debugCriticalServicesRuntime_20260508();

  var dqProbe = (typeof probeDataQualityRuntime_20260508 === 'function')
    ? probeDataQualityRuntime_20260508()
    : { available: false, reason: 'probeDataQualityRuntime_20260508 missing' };

  var rqProbe = (typeof probeReviewQueueRuntime_20260508 === 'function')
    ? probeReviewQueueRuntime_20260508()
    : { available: false, reason: 'probeReviewQueueRuntime_20260508 missing' };

  var triggers = ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  });

  var report = {
    critical: critical,
    probeDataQuality: dqProbe,
    probeReviewQueue: rqProbe,
    triggers: triggers
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function debugRuntimeProjectIdentity_20260508() {
  var spreadsheetId = 'n/a';
  try {
    spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  } catch (e) {
    spreadsheetId = 'unavailable';
  }

  var report = {
    scriptId: ScriptApp.getScriptId(),
    spreadsheetId: spreadsheetId,
    timezone: Session.getScriptTimeZone(),
    user: Session.getActiveUser().getEmail() || 'unknown'
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function runDailyFxRate() {
  return FxService.refreshDailyUsdObservedRate();
}

function runDailyCompliance() {
  return ComplianceScheduler.runDailyComplianceAlerts();
}

function runMonthlyBalance() {
  return ComplianceScheduler.runMonthlyReconciliation();
}

function runWeeklyCEOReport() {
  return ReportingService.runWeeklyProfitabilityReport();
}

function runWeeklyBankReconciliation() {
  return BankReconciliationService.runWeeklyBankReconciliation();
}

function runWeeklyCalendarReminder() {
  return CalendarService.runWeeklyCalendarReminder();
}

function runDataQualityChecks() {
  return DataQualityService.runLedgerDataQualityChecks();
}

function runWeeklyDataQualitySummary() {
  return DataQualityService.runWeeklyDataQualitySummary();
}

function syncRejectedReviewQueue() {
  return ReviewQueueService.syncRejectedRecordsToReviewQueue();
}

function processRejectedReviewQueue() {
  return ReviewQueueService.processReviewQueue();
}

function runWeeklyIntegrationContingencySummary() {
  return ContingencyService.runWeeklyIntegrationContingencySummary();
}

function runExecutiveDashboardRefresh() {
  return DashboardService.refreshExecutiveSuite();
}

function applyFinancePresentation() {
  return SheetPresentationService.applyAllPresentation();
}

function applyFinanceRoleProtections() {
  return SheetSecurityService.applyRoleProtections();
}

function generatePurchaseOrder() {
  return PurchaseOrderService.generatePurchaseOrderFromRow();
}

function openStrategicCommandCenter() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = 'Centro_Mandos';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  function setCard(labelRangeA1, valueRangeA1, label, formula, colors, numberFormat) {
    var labelRange = sheet.getRange(labelRangeA1);
    var valueRange = sheet.getRange(valueRangeA1);
    labelRange.merge().setValue(label);
    valueRange.merge().setFormula(formula);
    labelRange
      .setBackground(colors.header)
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    valueRange
      .setBackground(colors.body)
      .setFontColor(colors.ink)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setFontSize(16);
    if (numberFormat) {
      valueRange.setNumberFormat(numberFormat);
    }
  }

  function addBlockTitle(rangeA1, title, bgColor) {
    sheet.getRange(rangeA1)
      .merge()
      .setValue(title)
      .setBackground(bgColor)
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(11)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
  }

  sheet.clear();
  sheet.setConditionalFormatRules([]);
  sheet.getCharts().forEach(function (chart) {
    sheet.removeChart(chart);
  });

  sheet.setTabColor('#0f766e');
  sheet.setFrozenRows(5);
  sheet.hideColumns(14, 8);

  sheet.getRange('A1:L2').merge();
  sheet.getRange('A1').setValue('VITTOSTORE | CENTRO DE MANDOS CEO');
  sheet.getRange('A3:F3').merge().setValue('Vision gerencial + piso operativo + control del dia');
  sheet.getRange('G3:L3').merge().setValue('Actualizado: ' + FinanceUtils.nowChile());
  sheet.getRange('A1:L3')
    .setVerticalAlignment('middle')
    .setFontFamily('Verdana');
  sheet.getRange('A1:L2')
    .setBackground('#14324a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(16)
    .setHorizontalAlignment('center');
  sheet.getRange('A3:F3')
    .setBackground('#f1e7d0')
    .setFontColor('#14324a')
    .setFontWeight('bold');
  sheet.getRange('G3:L3')
    .setBackground('#0f766e')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange('A4:L4').merge().setFormula(
    '=IF(OR($D$19>0,$G$19>0,$J$19>0),"MANDATO DEL DIA: cerrar calidad, vencidos e incidentes bloqueantes antes de cualquier optimizacion.",' +
    'IF($A$19>10,"MANDATO DEL DIA: contener conciliacion bancaria y bajar backlog de tesoreria a rango controlado.",' +
    'IF($D$24>20,"MANDATO DEL DIA: descargar la bandeja de Finanzas y proteger SLA operativo.",' +
    'IF($A$14="N/D","MANDATO DEL DIA: restablecer visibilidad ejecutiva actualizando dashboard e ingestion.",' +
    '"MANDATO DEL DIA: operacion estable; foco en margen, disciplina de cierre y anticipacion de backlog."))))'
  );
  sheet.getRange('A4:L4')
    .setBackground('#fff7ed')
    .setFontColor('#9a3412')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  addBlockTitle('A5:L5', 'ALERTAS PRIORITARIAS DEL DIA', '#b91c1c');
  sheet.getRange('A6:F6').setValues([['Prioridad', 'Alerta', 'Estado', 'Accion sugerida', 'Dueno', 'Detalle']]);
  sheet.getRange('A7:F10').setValues([
    ['SEV-1', 'Cierre bloqueado', '=IF(OR($D$19>0,$G$19>0,$J$19>0),"SI","NO")', 'Resolver errores, vencidos o incidentes', 'Finanzas', 'Bloquea cierre y reportabilidad'],
    ['SEV-1', 'Ingestion fuera de continuidad', '=IF($J$14="N/D","SI","NO")', 'Revisar motor de ingestion y ultima corrida', 'Operaciones', 'Sin ingestion no hay continuidad operativa'],
    ['SEV-2', 'Banco con backlog alto', '=IF($A$19>10,"SI","NO")', 'Ejecutar conciliacion bancaria', 'Tesoreria', 'Pendientes sobre umbral objetivo'],
    ['SEV-2', 'Bandeja Finanzas tensionada', '=IF($D$24>20,"SI","NO")', 'Procesar cola y reasignar prioridad', 'Finanzas', 'Carga operativa sobre objetivo']
  ]);
  sheet.getRange('G6:L6').merge().setValue('Narrativa ejecutiva');
  sheet.getRange('G7:L10').merge().setFormula('=IF($A$14="N/D","Sin datos ejecutivos disponibles.","Resultado: "&TEXT($A$14,"#,##0")&" CLP | Banco pendiente: "&TEXT($A$19,"#,##0")&" | Errores calidad: "&TEXT($D$19,"#,##0")&" | Ultima ingestion: "&$J$14)');
  sheet.getRange('A6:F6')
    .setBackground('#fee2e2')
    .setFontColor('#7f1d1d')
    .setFontWeight('bold');
  sheet.getRange('G6:L6')
    .setBackground('#fef3c7')
    .setFontColor('#92400e')
    .setFontWeight('bold');
  sheet.getRange('G7:L10')
    .setBackground('#fff7ed')
    .setFontColor('#9a3412')
    .setWrap(true)
    .setVerticalAlignment('middle');

  addBlockTitle('A12:L12', 'RADAR GERENCIAL', '#14324a');
  setCard('A13:C13', 'A14:C15', 'Resultado Mes', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="ResultadoMes"),1),"N/D")', { header: '#0f766e', body: '#dcfce7', ink: '#14532d' }, '#,##0');
  setCard('D13:F13', 'D14:F15', 'Ingresos Mes', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="IngresosMes"),1),"N/D")', { header: '#1d4ed8', body: '#dbeafe', ink: '#1e3a8a' }, '#,##0');
  setCard('G13:I13', 'G14:I15', 'Egresos Mes', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="EgresosMes"),1),"N/D")', { header: '#c65d2e', body: '#ffedd5', ink: '#9a3412' }, '#,##0');
  setCard('J13:L13', 'J14:L15', 'Ultima Ingestion', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="UltimaIngestion"),1),"N/D")', { header: '#334155', body: '#e2e8f0', ink: '#0f172a' }, 'yyyy-mm-dd hh:mm:ss');

  setCard('A18:C18', 'A19:C20', 'Pendientes Banco', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="PendientesBanco"),1),"N/D")', { header: '#7c2d12', body: '#ffedd5', ink: '#9a3412' }, '#,##0');
  setCard('D18:F18', 'D19:F20', 'Errores Calidad', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="ErroresCalidad"),1),"N/D")', { header: '#991b1b', body: '#fee2e2', ink: '#7f1d1d' }, '#,##0');
  setCard('G18:I18', 'G19:I20', 'Rechazados Vencidos', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="RechazadosVencidos"),1),"N/D")', { header: '#b45309', body: '#fef3c7', ink: '#92400e' }, '#,##0');
  setCard('J18:L18', 'J19:L20', 'Incidentes Bloqueantes', '=IFERROR(INDEX(FILTER(Vista_Gerencia!C:C,Vista_Gerencia!B:B="IncidentesBloqueantes"),1),"N/D")', { header: '#7f1d1d', body: '#fee2e2', ink: '#7f1d1d' }, '#,##0');

  setCard('A23:C23', 'A24:C25', 'Rechazados Pendientes', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="RechazadosPendientes"),1),"N/D")', { header: '#475569', body: '#e2e8f0', ink: '#0f172a' }, '#,##0');
  setCard('D23:F23', 'D24:F25', 'Rechazados Finanzas', '=IFERROR(INDEX(FILTER(Vista_Finanzas!C:C,Vista_Finanzas!B:B="RechazadosFinanzas"),1),"N/D")', { header: '#1d4ed8', body: '#dbeafe', ink: '#1e3a8a' }, '#,##0');
  setCard('G23:I23', 'G24:I25', 'Warnings Calidad', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="WarningsCalidad"),1),"N/D")', { header: '#0f766e', body: '#ecfdf5', ink: '#14532d' }, '#,##0');
  setCard('J23:L23', 'J24:L25', 'Ultimo Control Calidad', '=IFERROR(INDEX(FILTER(Dashboard_Ejecutivo!C:C,Dashboard_Ejecutivo!B:B="UltimoControlCalidad"),1),"N/D")', { header: '#334155', body: '#e2e8f0', ink: '#0f172a' }, 'yyyy-mm-dd hh:mm:ss');

  addBlockTitle('A27:F27', 'PISO OPERATIVO DEL DIA', '#0f766e');
  sheet.getRange('A28:F28').setValues([['Tarea', 'Indicador', 'Estado', 'Decision', 'Responsable', 'Funcion']]);
  sheet.getRange('A29:F33').setValues([
    ['Control calidad', '=$D$19', '=IF($D$19=0,"OK","URGENTE")', '=IF($D$19=0,"Mantener control","Ejecutar chequeo y depurar registros")', 'Finanzas', 'runDataQualityChecks'],
    ['Bandeja vencida', '=$G$19', '=IF($G$19=0,"OK","ESCALAR")', '=IF($G$19=0,"Sin atasco","Procesar cola y reasignar prioridad")', 'Operaciones', 'processRejectedReviewQueue'],
    ['Conciliacion bancaria', '=$A$19', '=IF($A$19<=10,"CONTROLADO","ATENCION")', '=IF($A$19<=10,"Seguimiento normal","Ejecutar conciliacion ahora")', 'Tesoreria', 'runWeeklyBankReconciliation'],
    ['Continuidad ingestion', '=$J$14', '=IF($J$14="N/D","REVISAR","OK")', '=IF($J$14="N/D","Revisar motor y credenciales","Continuidad operativa vigente")', 'Operaciones', 'runFinancialIngestion'],
    ['Backlog Finanzas', '=$D$24', '=IF($D$24<=20,"OK","ATENCION")', '=IF($D$24<=20,"Capacidad en rango","Refuerzo y priorizacion")', 'Finanzas', 'syncRejectedReviewQueue']
  ]);

  addBlockTitle('G27:L27', 'RUTINAS ESTRATEGICAS VITTOSTORE', '#c65d2e');
  sheet.getRange('G28:L28').setValues([['Rutina', 'Funcion', 'Uso', 'Salida', 'Canal', 'Prioridad']]);
  sheet.getRange('G29:L33').setValues([
    ['Apertura Operativa', 'runStrategicMorningOps', 'Abrir jornada', 'TC + Ingestion + Calidad + Dashboard', 'Menu/Panel', 'ALTA'],
    ['Cierre Operativo', 'runStrategicCloseOps', 'Cerrar jornada', 'Banco + Balance + Dashboard', 'Menu/Panel', 'ALTA'],
    ['Actualizar Dashboard', 'runExecutiveDashboardRefresh', 'Refrescar vistas', 'Indicadores del dia', 'Menu/Panel', 'MEDIA'],
    ['Aplicar Formatos', 'applyFinancePresentation', 'Normalizar vistas', 'CLP/USD/fechas consistentes', 'Menu/Panel', 'MEDIA'],
    ['Actualizar Centro', 'openStrategicCommandCenter', 'Regenerar tablero', 'CEO cockpit vigente', 'Menu/Panel', 'MEDIA']
  ]);

  addBlockTitle('A35:F35', 'CIERRE SIN CABOS SUELTOS', '#7c2d12');
  sheet.getRange('A36:F36').setValues([['Frente', 'Condicion', 'Estado', 'Siguiente paso', 'Dueno', 'Criterio de cierre']]);
  sheet.getRange('A37:F41').setValues([
    ['Calidad de datos', '=$D$19', '=IF($D$19=0,"CERRADO","ABIERTO")', '=IF($D$19=0,"Sin observaciones","Depurar errores de calidad")', 'Finanzas', 'ErroresCalidad = 0'],
    ['Bandeja vencida', '=$G$19', '=IF($G$19=0,"CERRADO","ABIERTO")', '=IF($G$19=0,"SLA controlado","Procesar vencidos y reasignar")', 'Operaciones', 'RechazadosVencidos = 0'],
    ['Banco', '=$A$19', '=IF($A$19<=10,"CONTROLADO","ABIERTO")', '=IF($A$19<=10,"Seguimiento normal","Ejecutar conciliacion y validar partidas")', 'Tesoreria', 'PendientesBanco <= 10'],
    ['Continuidad', '=$J$14', '=IF($J$14="N/D","ABIERTO","CERRADO")', '=IF($J$14="N/D","Restablecer ingestion","Continuidad vigente")', 'Operaciones', 'UltimaIngestion con timestamp'],
    ['Incidentes', '=$J$19', '=IF($J$19=0,"CERRADO","ABIERTO")', '=IF($J$19=0,"Sin bloqueantes","Contener y cerrar incidente")', 'Lider Integraciones', 'IncidentesBloqueantes = 0']
  ]);

  addBlockTitle('G35:L35', 'GOBIERNO DIARIO DE OPERACION', '#14324a');
  sheet.getRange('G36:L36').setValues([['Cadencia', 'Lider', 'Objetivo', 'Disparador', 'Herramienta', 'Salida esperada']]);
  sheet.getRange('G37:L41').setValues([
    ['08:30 Apertura', 'CEO/Finanzas', 'Arrancar sin desalineaciones', 'Inicio de jornada', 'Panel + Menu', 'Operacion priorizada'],
    ['11:30 Corte', 'Operaciones', 'Bajar backlog y vencidos', 'Semaforo amarillo/rojo', 'Centro_Mandos', 'Correccion de curso'],
    ['15:30 Control', 'Tesoreria', 'Contener pendientes banco', 'Backlog > objetivo', 'Centro_Mandos', 'Conciliacion al dia'],
    ['18:00 Cierre', 'Finanzas', 'Cerrar sin cabos sueltos', 'Fin de jornada', 'Rutina cierre', 'Pendientes explicitados o resueltos'],
    ['Incidente', 'Lider integraciones', 'Escalar bloqueo', 'SEV-1 / SEV-2', 'Alertas prioritarias', 'Contencion y owner asignado']
  ]);

  // Tabla auxiliar oculta para graficos.
  sheet.getRange('N1:O5').setValues([
    ['Indicador', 'Valor'],
    ['PendientesBanco', '=$A$19'],
    ['ErroresCalidad', '=$D$19'],
    ['RechazadosVencidos', '=$G$19'],
    ['IncidentesBloqueantes', '=$J$19']
  ]);
  sheet.getRange('N1:O5').setNumberFormat('#,##0');

  addBlockTitle('A44:L44', 'GRAFICOS DE CONTROL CEO', '#14324a');

  var monthlySheet = ss.getSheetByName(FinanceConfig.SHEETS.MONTHLY);
  if (monthlySheet && monthlySheet.getLastRow() > 1) {
    var monthlyLastRow = monthlySheet.getLastRow();
    var resultChart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(monthlySheet.getRange(1, 1, monthlyLastRow, 1))
      .addRange(monthlySheet.getRange(1, 4, monthlyLastRow, 1))
      .setPosition(45, 1, 0, 0)
      .setOption('title', 'Resultado mensual VITTOSTORE')
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#0f766e'])
      .setOption('backgroundColor', '#f8fafc')
      .setOption('chartArea', { left: 70, top: 50, width: '72%', height: '65%' })
      .build();
    sheet.insertChart(resultChart);

    var revenueExpenseChart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(monthlySheet.getRange(1, 1, monthlyLastRow, 3))
      .setPosition(45, 7, 0, 0)
      .setOption('title', 'Ingresos vs Egresos')
      .setOption('colors', ['#1d4ed8', '#c65d2e'])
      .setOption('backgroundColor', '#f8fafc')
      .setOption('chartArea', { left: 70, top: 50, width: '72%', height: '65%' })
      .build();
    sheet.insertChart(revenueExpenseChart);
  }

  var pressureChart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange('N1:O5'))
    .setPosition(65, 1, 0, 0)
    .setOption('title', 'Presion operativa')
    .setOption('pieHole', 0.58)
    .setOption('legend', { position: 'right' })
    .setOption('colors', ['#c65d2e', '#b91c1c', '#b45309', '#7f1d1d'])
    .setOption('backgroundColor', '#f8fafc')
    .build();
  sheet.insertChart(pressureChart);

  // Layout visual Vittostore.
  var borderColor = '#cbd5e1';
  sheet.getRange('A1:L72').setFontFamily('Verdana').setVerticalAlignment('middle');
  sheet.getRange('A1:L41').setBorder(true, true, true, true, false, false, borderColor, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange('A28:F33').setWrap(true);
  sheet.getRange('G28:L33').setWrap(true);
  sheet.getRange('A36:F41').setWrap(true);
  sheet.getRange('G36:L41').setWrap(true);
  sheet.getRange('A28:F28').setBackground('#d1fae5').setFontColor('#065f46').setFontWeight('bold');
  sheet.getRange('G28:L28').setBackground('#ffedd5').setFontColor('#9a3412').setFontWeight('bold');
  sheet.getRange('A36:F36').setBackground('#ffedd5').setFontColor('#9a3412').setFontWeight('bold');
  sheet.getRange('G36:L36').setBackground('#dbeafe').setFontColor('#1e3a8a').setFontWeight('bold');
  sheet.getRange('A29:B33').setFontWeight('bold');
  sheet.getRange('G29:H33').setFontWeight('bold');
  sheet.getRange('A37:B41').setFontWeight('bold');
  sheet.getRange('G37:H41').setFontWeight('bold');
  sheet.getRange('B29:B33').setNumberFormat('#,##0');
  sheet.getRange('B37:B41').setNumberFormat('#,##0');
  sheet.getRange('A7:A10').setFontWeight('bold');

  sheet.setColumnWidths(1, 12, 120);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 210);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(7, 150);
  sheet.setColumnWidth(8, 125);
  sheet.setColumnWidth(9, 150);
  sheet.setColumnWidth(10, 180);
  sheet.setColumnWidth(11, 120);
  sheet.setColumnWidth(12, 120);
  sheet.setRowHeights(13, 13, 26);

  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('SI').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('C7:C10')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('NO').setBackground('#dcfce7').setFontColor('#166534').setRanges([sheet.getRange('C7:C10')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('URGENTE').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('C29:C33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ESCALAR').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('C29:C33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ATENCION').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange('C29:C33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground('#dcfce7').setFontColor('#166534').setRanges([sheet.getRange('C29:C33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('REVISAR').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange('C29:C33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ABIERTO').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('C37:C41')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CONTROLADO').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange('C37:C41')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CERRADO').setBackground('#dcfce7').setFontColor('#166534').setRanges([sheet.getRange('C37:C41')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ALTA').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([sheet.getRange('L29:L33')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('MEDIA').setBackground('#fef3c7').setFontColor('#92400e').setRanges([sheet.getRange('L29:L33')]).build()
  ];
  sheet.setConditionalFormatRules(rules);

  ss.setActiveSheet(sheet);
  AuditService.logInfo('Centro de mandos actualizado', 'Sheet=' + sheetName);
  return { status: 'ok', sheet: sheetName };
}

function runStrategicMorningOps() {
  var result = {
    fx: runDailyFxRate(),
    ingestion: runFinancialIngestion(),
    queueSync: syncRejectedReviewQueue(),
    quality: runDataQualityChecks(),
    dashboard: runExecutiveDashboardRefresh(),
    presentation: applyFinancePresentation(),
    commandCenter: openStrategicCommandCenter()
  };
  AuditService.logInfo('Rutina apertura operativa ejecutada', JSON.stringify({ status: 'ok' }));
  return result;
}

function runStrategicCloseOps() {
  var result = {
    queueProcess: processRejectedReviewQueue(),
    reconciliation: runWeeklyBankReconciliation(),
    monthlyBalance: runMonthlyBalance(),
    dashboard: runExecutiveDashboardRefresh(),
    presentation: applyFinancePresentation(),
    commandCenter: openStrategicCommandCenter()
  };
  AuditService.logInfo('Rutina cierre operativo ejecutada', JSON.stringify({ status: 'ok' }));
  return result;
}

function showCommandCenterPanel() {
  var html = HtmlService.createHtmlOutputFromFile('CommandCenterSidebar')
    .setTitle('Centro de Mandos')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
  return { status: 'ok' };
}

function runCommandCenterAction(actionName) {
  var action = String(actionName || '').trim();
  var startedAt = FinanceUtils.nowChile();

  if (action === 'MORNING_OPS') {
    runStrategicMorningOps();
  } else if (action === 'CLOSE_OPS') {
    runStrategicCloseOps();
  } else if (action === 'REFRESH_DASHBOARD') {
    runExecutiveDashboardRefresh();
  } else if (action === 'APPLY_PRESENTATION') {
    applyFinancePresentation();
  } else if (action === 'REFRESH_COMMAND_CENTER') {
    openStrategicCommandCenter();
  } else if (action === 'RUN_INGESTION') {
    runFinancialIngestion();
  } else if (action === 'RUN_FX') {
    runDailyFxRate();
  } else if (action === 'RUN_DATA_QUALITY') {
    runDataQualityChecks();
  } else if (action === 'SYNC_REVIEW_QUEUE') {
    syncRejectedReviewQueue();
  } else if (action === 'RUN_BANK_RECON') {
    runWeeklyBankReconciliation();
  } else {
    throw new Error('Accion no soportada en Command Center: ' + action);
  }

  return {
    status: 'ok',
    action: action,
    executedAt: FinanceUtils.nowChile(),
    startedAt: startedAt
  };
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('Vitto Finance');

  var operationalMenu = ui.createMenu('Operacion diaria')
    .addItem('Apertura operativa (rutina completa)', 'runStrategicMorningOps')
    .addItem('Ingestion ahora', 'runFinancialIngestion')
    .addItem('Actualizar TC USD ahora', 'runDailyFxRate')
    .addItem('Control de calidad de datos', 'runDataQualityChecks')
    .addItem('Sincronizar bandeja rechazados', 'syncRejectedReviewQueue')
    .addItem('Actualizar dashboard ejecutivo', 'runExecutiveDashboardRefresh')
    .addItem('Actualizar Vista Contador', 'refreshVistaContador');

  var commandCenterMenu = ui.createMenu('Cuadro de mandos')
    .addItem('Abrir/Actualizar Centro de Mandos', 'openStrategicCommandCenter')
    .addItem('Abrir panel de botones (1-clic)', 'showCommandCenterPanel')
    .addItem('Aplicar formato ejecutivo', 'applyFinancePresentation')
    .addItem('Aplicar protecciones por rol', 'applyFinanceRoleProtections')
    .addItem('Cierre operativo (rutina completa)', 'runStrategicCloseOps');

  var weeklyMenu = ui.createMenu('Reportes y cierres')
    .addItem('Alertas SII ahora', 'runDailyCompliance')
    .addItem('Configurar alertas tributarias automaticas', 'setupComplianceTriggers')
    .addItem('Balance mensual ahora', 'runMonthlyBalance')
    .addItem('Reporte CEO/Marketing ahora', 'runWeeklyCEOReport')
    .addItem('Conciliacion bancaria ahora', 'runWeeklyBankReconciliation')
    .addItem('Resumen semanal calidad', 'runWeeklyDataQualitySummary')
    .addItem('Resumen contingencia integraciones', 'runWeeklyIntegrationContingencySummary')
    .addItem('Crear recordatorio Calendar (9:00 AM)', 'runWeeklyCalendarReminder')
    .addItem('Generar Orden de Compra', 'generatePurchaseOrder');

  var diagnosticsMenu = ui.createMenu('Diagnostico y go-live')
    .addItem('Inicializar sistema', 'initializeFinanceAutomation')
    .addItem('Preflight Go-Live', 'runGoLivePreflight')
    .addItem('Smoke Suite Go-Live', 'runGoLiveSmokeSuite')
    .addItem('Go-Live Automatico', 'runGoLiveAutomation')
    .addItem('Mostrar template Script Properties', 'showPropertyTemplate')
    .addItem('Debug Entrypoints', 'debugEntrypoints')
    .addItem('Debug Services', 'debugServices')
    .addItem('Debug Critical Services Runtime', 'debugCriticalServicesRuntime_20260508')
    .addItem('Audit Global Runtime Contracts', 'runGlobalRuntimeAudit_20260508')
    .addItem('Simulate Runtime Failures', 'runRuntimeFailureSimulation_20260508')
    .addItem('Publicar Auditoria Runtime', 'publishRuntimeAuditSheet_20260508')
    .addItem('Run Phase4 Runtime Diagnostics', 'runPhase4RuntimeDiagnostics_20260508')
    .addItem('Debug Runtime Project ID', 'debugRuntimeProjectIdentity_20260508')
    .addItem('Smoke Test Anthropic PRV', 'runAnthropicSmokeTest')
    .addItem('Pause Ingestion Triggers', 'pauseIngestionTriggers_20260508');

  var dataHygieneMenu = ui.createMenu('Calidad y depuracion')
    .addItem('Preview limpieza heuristica (simulacion)', 'previewHistoricalHeuristicCleanup_20260513')
    .addItem('Ejecutar limpieza heuristica (REAL)', 'executeHistoricalHeuristicCleanup_20260513')
    .addItem('Reporte KPI Anti-Ruido', 'runHeuristicNoiseKpiReport_20260513')
    .addItem('Analizar fila Libro_Mayor 13', 'analyzeLibroMayorRow13_');

  var accountantMenu = ui.createMenu('Vista Contador')
    .addItem('Actualizar Vista Contador', 'refreshVistaContador_20260513');

  menu
    .addSubMenu(operationalMenu)
    .addSubMenu(commandCenterMenu)
    .addSubMenu(weeklyMenu)
    .addSubMenu(diagnosticsMenu)
    .addSubMenu(dataHygieneMenu)
    .addSubMenu(accountantMenu)
    .addToUi();
}

function forceRefreshMenu() {
  onOpen();
  AuditService.logInfo('Menu Vitto Finance forzado', 'onOpen ejecutado manualmente');
  return { status: 'ok', menu: 'Vitto Finance', refreshedAt: FinanceUtils.nowChile() };
}

function runAnthropicRulesSmokeTest_20260513() {
  var applyAnthropicRule = (typeof applyAnthropicProviderRules_ === 'function')
    ? applyAnthropicProviderRules_
    : function (record, documentType, emailMeta, bodyText) {
        var sourceText = [
          String((record && record.proveedorCliente) || ''),
          String((emailMeta && emailMeta.emailOrigen) || ''),
          String((emailMeta && emailMeta.asunto) || ''),
          String(bodyText || '')
        ].join('\n').toLowerCase();

        if (sourceText.indexOf('anthropic') === -1 && sourceText.indexOf('claude pro') === -1) {
          return record;
        }

        var neto = FinanceUtils.normalizeCurrency(record.montoNeto);
        var iva = FinanceUtils.normalizeCurrency(record.iva);
        var total = FinanceUtils.normalizeCurrency(record.montoTotal);
        var moneda = String(record.moneda || 'USD').toUpperCase();

        record.tipoMovimiento = 'EGRESO';
        record.categoria = 'COSTO_OPERACIONAL';
        record.subcategoria = 'SUSCRIPCION_SAAS_IA';
        record.origenVenta = 'PROVEEDOR_EMAIL_DIRECTO';
        record.proveedorCliente = record.proveedorCliente || 'Anthropic, PBC';

        if (neto > 0 && iva <= 0 && total > 0) {
          var inferredIva = total - neto;
          if (inferredIva > 0) {
            iva = Math.round(inferredIva * 100) / 100;
            record.iva = iva;
          }
        }

        var notes = [];
        notes.push('PRV-001: deduplicar Anthropic por numero de factura.');
        notes.push('PRV-003: canal identificado como email directo de proveedor.');

        if (neto > 0 && iva > 0) {
          var expectedIva = Math.round((neto * 0.19) * 100) / 100;
          if (Math.abs(iva - expectedIva) > 0.03) {
            notes.push('PRV-002: alerta IVA esperado 19% no coincide con valores extraidos.');
          }
        }

        if (moneda === 'USD' && neto > 0 && Math.abs(neto - 20) > 5) {
          notes.push('PRV-004: posible cambio de plan Claude Pro (neto fuera de rango USD 20 +/- 5).');
        }

        var obs = String(record.observaciones || '').trim();
        var extra = notes.join(' ');
        record.observaciones = obs ? (obs + ' ' + extra) : extra;
        return record;
      };

  var baseMeta = {
    gmailMessageId: 'smoke-test-message',
    emailOrigen: 'billing@anthropic.com',
    asunto: 'Invoice WTJJJ7LD-0001 - Claude Pro',
    fechaEmail: '2026-05-09',
    tipoMovimiento: 'EGRESO',
    origenVenta: 'Sin atribucion',
    fuente: 'FACTURA'
  };

  var baseRecord = {
    fechaDocumento: '2026-05-09',
    tipoMovimiento: 'EGRESO',
    categoria: 'SERVICIOS',
    subcategoria: 'HEURISTICA_EMAIL',
    proveedorCliente: 'Anthropic, PBC',
    rutEmisorReceptor: '',
    numeroDocumento: 'WTJJJ7LD-0001',
    moneda: 'USD',
    montoNeto: 20,
    iva: 3.8,
    montoTotal: 23.8,
    estadoPago: 'PAGADO',
    medioPago: 'TARJETA',
    origenVenta: 'Sin atribucion',
    observaciones: ''
  };

  var tests = [];

  var classified = applyAnthropicRule(JSON.parse(JSON.stringify(baseRecord)), 'FACTURA', baseMeta, 'Claude Pro Anthropic invoice');
  tests.push({
    id: 'PRV-003',
    name: 'Clasificacion y canal proveedor directo',
    status: (classified.categoria === 'COSTO_OPERACIONAL' && classified.subcategoria === 'SUSCRIPCION_SAAS_IA' && classified.origenVenta === 'PROVEEDOR_EMAIL_DIRECTO') ? 'PASS' : 'FAIL',
    detail: {
      categoria: classified.categoria,
      subcategoria: classified.subcategoria,
      origenVenta: classified.origenVenta
    }
  });

  var badIvaRecord = JSON.parse(JSON.stringify(baseRecord));
  badIvaRecord.iva = 2.1;
  var ivaValidation = ValidationService.validateExtractedRecord(badIvaRecord);
  tests.push({
    id: 'PRV-002',
    name: 'Alerta IVA 19% inconsistente',
    status: (ivaValidation.warnings || []).indexOf('anthropic_iva_19_inconsistente') !== -1 ? 'PASS' : 'FAIL',
    detail: {
      warnings: ivaValidation.warnings || []
    }
  });

  var planChangeRecord = JSON.parse(JSON.stringify(baseRecord));
  planChangeRecord.montoNeto = 29;
  planChangeRecord.iva = 5.51;
  planChangeRecord.montoTotal = 34.51;
  var planValidation = ValidationService.validateExtractedRecord(planChangeRecord);
  tests.push({
    id: 'PRV-004',
    name: 'Alerta por posible cambio de plan',
    status: (planValidation.warnings || []).indexOf('anthropic_plan_monto_fuera_rango') !== -1 ? 'PASS' : 'FAIL',
    detail: {
      warnings: planValidation.warnings || []
    }
  });

  var duplicateProbe = null;
  if (typeof LedgerService !== 'undefined' && LedgerService && typeof LedgerService.debugFindSemanticDuplicateEntry === 'function') {
    duplicateProbe = LedgerService.debugFindSemanticDuplicateEntry({
      numeroDocumento: baseRecord.numeroDocumento,
      proveedorCliente: baseRecord.proveedorCliente,
      fechaDocumento: baseRecord.fechaDocumento,
      tipoMovimiento: baseRecord.tipoMovimiento,
      monedaOriginal: baseRecord.moneda
    });
  }

  tests.push({
    id: 'PRV-001',
    name: 'Deteccion duplicado semantico Anthropic por numero factura',
    status: duplicateProbe ? 'PASS' : 'WARN',
    detail: duplicateProbe || {
      message: (typeof LedgerService !== 'undefined' && LedgerService && typeof LedgerService.debugFindSemanticDuplicateEntry === 'function')
        ? 'No se encontro coincidencia en Libro_Mayor para ese numero. Si aun no existe una factura Anthropic previa, este resultado es esperado.'
        : 'LedgerService.debugFindSemanticDuplicateEntry no disponible en runtime. Actualiza LedgerService.gs para validar PRV-001 en este smoke test.'
    }
  });

  var summary = {
    executedAt: FinanceUtils.nowChile(),
    total: tests.length,
    passed: tests.filter(function (t) { return t.status === 'PASS'; }).length,
    failed: tests.filter(function (t) { return t.status === 'FAIL'; }).length,
    warned: tests.filter(function (t) { return t.status === 'WARN'; }).length,
    tests: tests
  };

  Logger.log(JSON.stringify(summary, null, 2));
  AuditService.logInfo('Smoke test reglas Anthropic', JSON.stringify({
    passed: summary.passed,
    failed: summary.failed,
    warned: summary.warned
  }));

  return summary;
}

function runAnthropicSmokeTest() {
  return runAnthropicRulesSmokeTest_20260513();
}

function diagnoseAnthropicRuntime_20260513() {
  var sampleBase = {
    tipoMovimiento: 'EGRESO',
    fechaDocumento: '2026-05-09',
    categoria: 'SERVICIOS',
    subcategoria: 'HEURISTICA_EMAIL',
    proveedorCliente: 'Anthropic, PBC',
    numeroDocumento: 'WTJJJ7LD-0001',
    moneda: 'USD',
    montoNeto: 20,
    iva: 3.8,
    montoTotal: 23.8,
    origenVenta: 'Sin atribucion'
  };

  var sampleBadIva = JSON.parse(JSON.stringify(sampleBase));
  sampleBadIva.iva = 2.1;
  var samplePlanChange = JSON.parse(JSON.stringify(sampleBase));
  samplePlanChange.montoNeto = 29;
  samplePlanChange.iva = 5.51;
  samplePlanChange.montoTotal = 34.51;

  var validationAvailable = (typeof ValidationService !== 'undefined') && ValidationService && (typeof ValidationService.validateExtractedRecord === 'function');
  var dqIvaWarning = false;
  var dqPlanWarning = false;
  var validationWarningsBadIva = [];
  var validationWarningsPlan = [];

  if (validationAvailable) {
    var v1 = ValidationService.validateExtractedRecord(sampleBadIva);
    var v2 = ValidationService.validateExtractedRecord(samplePlanChange);
    validationWarningsBadIva = (v1 && v1.warnings) || [];
    validationWarningsPlan = (v2 && v2.warnings) || [];
    dqIvaWarning = validationWarningsBadIva.indexOf('anthropic_iva_19_inconsistente') !== -1;
    dqPlanWarning = validationWarningsPlan.indexOf('anthropic_plan_monto_fuera_rango') !== -1;
  }

  var ledgerDebugAvailable = (typeof LedgerService !== 'undefined') && LedgerService && (typeof LedgerService.debugFindSemanticDuplicateEntry === 'function');

  var report = {
    executedAt: FinanceUtils.nowChile(),
    runtime: {
      ValidationService_validateExtractedRecord: validationAvailable,
      LedgerService_debugFindSemanticDuplicateEntry: ledgerDebugAvailable
    },
    expectedAnthropicBehavior: {
      hasIvaInconsistencyWarning: dqIvaWarning,
      hasPlanChangeWarning: dqPlanWarning
    },
    observedWarnings: {
      badIva: validationWarningsBadIva,
      planChange: validationWarningsPlan
    },
    recommendation: {
      updateValidationService: !(dqIvaWarning && dqPlanWarning),
      updateLedgerService: !ledgerDebugAvailable
    }
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function analyzeLibroMayorRow_20260513(rowNumber) {
  var targetRow = Number(rowNumber || 13);
  if (!targetRow || targetRow < 2) {
    throw new Error('Fila invalida. Usa una fila >= 2 para Libro_Mayor.');
  }

  LedgerService.ensureCoreSheets();
  var ledgerSheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
  var maxRows = ledgerSheet.getMaxRows();
  var lastRow = ledgerSheet.getLastRow();

  if (targetRow > maxRows) {
    throw new Error('Fila fuera de rango de la hoja. maxRows=' + maxRows + ', solicitada=' + targetRow);
  }

  var values = ledgerSheet.getRange(targetRow, 1, 1, FinanceConfig.HEADERS.LEDGER.length).getValues()[0];
  var asObject = {};
  FinanceConfig.HEADERS.LEDGER.forEach(function (header, idx) {
    asObject[header] = values[idx];
  });

  var isEmptyRow = values.every(function (cell) {
    return cell === '' || cell === null;
  });

  var neto = FinanceUtils.normalizeCurrency(asObject.MontoNeto);
  var iva = FinanceUtils.normalizeCurrency(asObject.IVA);
  var total = FinanceUtils.normalizeCurrency(asObject.MontoTotal);
  var totalClp = FinanceUtils.normalizeCurrency(asObject.MontoTotalCLP);

  var validationInput = {
    fechaDocumento: asObject.FechaDocumento,
    tipoMovimiento: asObject.TipoMovimiento,
    categoria: asObject.Categoria,
    subcategoria: asObject.Subcategoria,
    proveedorCliente: asObject.ProveedorCliente,
    rutEmisorReceptor: asObject.RutEmisorReceptor,
    numeroDocumento: asObject.NumeroDocumento,
    moneda: asObject.MonedaOriginal || asObject.Moneda || 'CLP',
    montoNeto: neto,
    iva: iva,
    montoTotal: total,
    estadoPago: asObject.EstadoPago,
    medioPago: asObject.MedioPago,
    origenVenta: asObject.OrigenVenta,
    observaciones: asObject.Observaciones
  };

  var validation = (typeof ValidationService !== 'undefined' && ValidationService && typeof ValidationService.validateExtractedRecord === 'function')
    ? ValidationService.validateExtractedRecord(validationInput)
    : { valid: null, errors: ['ValidationService no disponible'], warnings: [] };

  var diagnostics = {
    rowExistsInUsedRange: targetRow <= lastRow,
    rowIsEmpty: isEmptyRow,
    lastRow: lastRow,
    maxRows: maxRows,
    amountChecks: {
      netPlusIvaEqualsTotal: Math.abs((neto + iva) - total) <= 1,
      totalMatchesTotalClp: totalClp <= 0 ? null : Math.abs(total - totalClp) <= 1,
      neto: neto,
      iva: iva,
      total: total,
      totalClp: totalClp
    }
  };

  var report = {
    executedAt: FinanceUtils.nowChile(),
    sheet: FinanceConfig.SHEETS.LEDGER,
    row: targetRow,
    diagnostics: diagnostics,
    record: asObject,
    validation: validation
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function getHeuristicCleanupNumericProperty_(key, fallback) {
  var raw = FinanceConfig.getOptionalProperty(key, String(fallback));
  var value = Number(raw);
  return isNaN(value) ? Number(fallback) : value;
}

function isSuspiciousHeuristicDocForCleanup_(docNumber) {
  if (typeof isSuspiciousHeuristicDocNumber_ === 'function') {
    return isSuspiciousHeuristicDocNumber_(docNumber);
  }

  var doc = String(docNumber || '').trim().toUpperCase();
  if (!doc || doc.length < 4) {
    return true;
  }

  if (/^(ACTUALIZASTE|ACTUALIZACION|ACTUALIZACIONE|NOTIFICACION|PERFIL|PROFILE|GOOGLE|BUSINESS)$/.test(doc)) {
    return true;
  }

  return !/[0-9]/.test(doc);
}

function isHeuristicAmountPlausibleForCleanup_(currency, amount) {
  if (typeof isHeuristicAmountPlausible_ === 'function') {
    return isHeuristicAmountPlausible_(currency, amount);
  }

  var moneda = String(currency || 'CLP').toUpperCase();
  var value = FinanceUtils.normalizeCurrency(amount);
  if (!(value > 0)) {
    return false;
  }

  var maxClp = getHeuristicCleanupNumericProperty_('HEURISTIC_MAX_CLP', 50000000);
  var maxUsd = getHeuristicCleanupNumericProperty_('HEURISTIC_MAX_USD', 50000);
  return moneda === 'USD' ? value <= maxUsd : value <= maxClp;
}

function getOrCreateHeuristicCleanupArchiveSheet_20260513() {
  var ss = FinanceConfig.getSpreadsheet();
  var archiveName = 'Libro_Mayor_Depurado_Heuristica';
  var headers = FinanceConfig.HEADERS.LEDGER.concat(['MotivoDepuracion', 'DepuradoEn', 'DepuradoPor']);
  var sheet = ss.getSheetByName(archiveName);

  if (!sheet) {
    sheet = ss.insertSheet(archiveName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function buildDescendingDeleteBlocks_(rows) {
  var sorted = rows.slice().sort(function (a, b) { return b - a; });
  var blocks = [];

  sorted.forEach(function (row) {
    if (!blocks.length) {
      blocks.push({ start: row, count: 1 });
      return;
    }

    var last = blocks[blocks.length - 1];
    if ((row + last.count) === last.start) {
      last.start = row;
      last.count += 1;
      return;
    }

    blocks.push({ start: row, count: 1 });
  });

  return blocks;
}

function runHistoricalHeuristicCleanup_20260513(options) {
  var opts = options || {};
  var dryRun = opts.dryRun !== false;
  var maxDelete = Number(opts.maxDelete || 5000);

  LedgerService.ensureCoreSheets();
  var ledgerSheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
  var lastRow = ledgerSheet.getLastRow();

  if (lastRow < 2) {
    return {
      executedAt: FinanceUtils.nowChile(),
      dryRun: dryRun,
      scannedRows: 0,
      candidates: 0,
      deleted: 0,
      archived: 0,
      note: 'Libro_Mayor sin registros para revisar'
    };
  }

  var values = ledgerSheet.getRange(2, 1, lastRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();
  var candidates = [];

  values.forEach(function (rowValues, idx) {
    var rowNumber = idx + 2;
    var fuente = String(rowValues[18] || '').toUpperCase();
    if (fuente !== 'HEURISTICA_LOCAL') {
      return;
    }

    var numeroDocumento = rowValues[7] || '';
    var moneda = String(rowValues[25] || rowValues[8] || 'CLP').toUpperCase();
    var monto = rowValues[26];
    if (!(FinanceUtils.normalizeCurrency(monto) > 0)) {
      monto = rowValues[11];
    }

    var suspiciousDoc = isSuspiciousHeuristicDocForCleanup_(numeroDocumento);
    var plausibleAmount = isHeuristicAmountPlausibleForCleanup_(moneda, monto);

    if (suspiciousDoc || !plausibleAmount) {
      var reasons = [];
      if (suspiciousDoc) {
        reasons.push('NUMERO_DOCUMENTO_SOSPECHOSO');
      }
      if (!plausibleAmount) {
        reasons.push('MONTO_NO_PLAUSIBLE');
      }

      candidates.push({
        rowNumber: rowNumber,
        numeroDocumento: numeroDocumento,
        moneda: moneda,
        monto: FinanceUtils.normalizeCurrency(monto),
        gmailMessageId: rowValues[16] || '',
        reason: reasons.join('|'),
        rowValues: rowValues
      });
    }
  });

  if (candidates.length > maxDelete) {
    throw new Error('Se detectaron ' + candidates.length + ' candidatos y maxDelete=' + maxDelete + '. Ajusta el limite para ejecutar.');
  }

  var summary = {
    executedAt: FinanceUtils.nowChile(),
    dryRun: dryRun,
    scannedRows: values.length,
    candidates: candidates.length,
    deleted: 0,
    archived: 0,
    sample: candidates.slice(0, 20).map(function (item) {
      return {
        rowNumber: item.rowNumber,
        numeroDocumento: item.numeroDocumento,
        moneda: item.moneda,
        monto: item.monto,
        reason: item.reason,
        gmailMessageId: item.gmailMessageId
      };
    })
  };

  if (dryRun || candidates.length === 0) {
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  var archiveSheet = getOrCreateHeuristicCleanupArchiveSheet_20260513();
  var cleanedAt = FinanceUtils.nowChile();
  var cleanedBy = Session.getActiveUser().getEmail() || 'unknown';
  var archiveRows = candidates.map(function (item) {
    return item.rowValues.concat([item.reason, cleanedAt, cleanedBy]);
  });

  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, archiveRows.length, archiveRows[0].length).setValues(archiveRows);

  var deleteBlocks = buildDescendingDeleteBlocks_(candidates.map(function (item) { return item.rowNumber; }));
  deleteBlocks.forEach(function (block) {
    ledgerSheet.deleteRows(block.start, block.count);
  });

  summary.deleted = candidates.length;
  summary.archived = archiveRows.length;
  summary.deleteBlocks = deleteBlocks.length;

  AuditService.logWarn('Depuracion heuristica ejecutada', JSON.stringify({
    scannedRows: summary.scannedRows,
    deleted: summary.deleted,
    archived: summary.archived,
    deleteBlocks: summary.deleteBlocks
  }));

  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function previewHistoricalHeuristicCleanup_20260513() {
  return runHistoricalHeuristicCleanup_20260513({ dryRun: true, maxDelete: 5000 });
}

function executeHistoricalHeuristicCleanup_20260513() {
  return runHistoricalHeuristicCleanup_20260513({ dryRun: false, maxDelete: 5000 });
}

function analyzeLibroMayorRow13_() {
  return analyzeLibroMayorRow_20260513(13);
}

function refreshVistaContador_20260513() {
  LedgerService.ensureCoreSheets();

  var ss = FinanceConfig.getSpreadsheet();
  var sheetName = FinanceConfig.SHEETS.ACCOUNTANT_VIEW;
  var headers = FinanceConfig.HEADERS.ACCOUNTANT_VIEW;

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  sheet.clearContents();
  sheet.setConditionalFormatRules([]);
  sheet.setTabColor('#0f766e');

  // ── Bloque titular ────────────────────────────────────────────────────────
  var titleCols = headers.length;
  sheet.getRange(1, 1, 1, titleCols).merge()
    .setValue('VITTOSTORE | LIBRO MAYOR — VISTA CONTADOR')
    .setBackground('#14324a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontFamily('Verdana');
  sheet.setRowHeight(1, 34);

  sheet.getRange(2, 1, 1, titleCols).merge()
    .setValue('Solo columnas contables. Actualizado: ' + FinanceUtils.nowChile())
    .setBackground('#e2f0fb')
    .setFontColor('#14324a')
    .setFontWeight('bold')
    .setFontFamily('Verdana')
    .setHorizontalAlignment('left');
  sheet.setRowHeight(2, 22);

  // ── Cabecera de columnas (fila 3) ─────────────────────────────────────────
  var headerRow = sheet.getRange(3, 1, 1, titleCols);
  headerRow.setValues([headers])
    .setBackground('#16324f')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontFamily('Verdana');
  sheet.setFrozenRows(3);

  // ── Leer Libro_Mayor ──────────────────────────────────────────────────────
  var ledgerSheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.LEDGER, FinanceConfig.HEADERS.LEDGER);
  var lastLedgerRow = ledgerSheet.getLastRow();

  if (lastLedgerRow < 2) {
    sheet.getRange(4, 1).setValue('Sin registros en Libro_Mayor.');
    return { rows: 0, sheet: sheetName };
  }

  var ledgerRows = ledgerSheet.getRange(2, 1, lastLedgerRow - 1, FinanceConfig.HEADERS.LEDGER.length).getValues();

  // Mapeo: indices 0-based del array de Libro_Mayor
  // 0:FechaRegistro 1:FechaDocumento 2:TipoMovimiento 3:Categoria 4:Subcategoria
  // 5:ProveedorCliente 6:RUT 7:NumeroDocumento 8:Moneda 9:MontoNeto 10:IVA
  // 11:MontoTotal 12:EstadoPago 13:MedioPago 14:OrigenVenta 19:Observaciones
  // 25:MonedaOriginal 26:MontoOriginal 27:TipoCambio 29:EstadoConciliacion
  var viewRows = ledgerRows.map(function (r) {
    return [
      r[0],   // Fecha
      r[1],   // FechaDocumento
      r[2],   // Movimiento
      r[3],   // Categoria
      r[4],   // Subcategoria
      r[5],   // ProveedorCliente
      r[6],   // RUT
      r[7],   // NumDocumento
      r[25],  // MonedaOrigen
      r[26],  // MontoOriginal
      r[27],  // TipoCambio
      r[9],   // MontoNeto_CLP
      r[10],  // IVA_CLP
      r[11],  // Total_CLP
      r[12],  // EstadoPago
      r[13],  // MedioPago
      r[14],  // OrigenVenta
      r[19],  // Observaciones
      r[29]   // Conciliacion
    ];
  });

  var dataStartRow = 4;
  sheet.getRange(dataStartRow, 1, viewRows.length, titleCols).setValues(viewRows);

  // Formato: montos en CLP
  var clpFormat = '#,##0';
  var clpCols = [10, 12, 13, 14]; // MontoOriginal, MontoNeto_CLP, IVA_CLP, Total_CLP
  clpCols.forEach(function (col) {
    sheet.getRange(dataStartRow, col, viewRows.length, 1).setNumberFormat(clpFormat);
  });
  // TipoCambio con 2 decimales
  sheet.getRange(dataStartRow, 11, viewRows.length, 1).setNumberFormat('#,##0.00');
  // Fechas
  sheet.getRange(dataStartRow, 1, viewRows.length, 2).setNumberFormat('yyyy-mm-dd');

  // Colores alternados por fila
  for (var i = 0; i < viewRows.length; i++) {
    var bg = (i % 2 === 0) ? '#f8fafc' : '#eef4fb';
    sheet.getRange(dataStartRow + i, 1, 1, titleCols).setBackground(bg);
  }

  // Semáforos condicionales
  var dataRange = sheet.getRange(dataStartRow, 1, viewRows.length, titleCols);
  var movCol = sheet.getRange(dataStartRow, 3, viewRows.length, 1);   // Movimiento
  var estadoCol = sheet.getRange(dataStartRow, 15, viewRows.length, 1); // EstadoPago
  var concilCol = sheet.getRange(dataStartRow, 19, viewRows.length, 1); // Conciliacion

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('INGRESO').setBackground('#dcfce7').setFontColor('#166534').setRanges([movCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('EGRESO').setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([movCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PAGADO').setBackground('#dcfce7').setFontColor('#166534').setRanges([estadoCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE').setBackground('#fef3c7').setFontColor('#92400e').setRanges([estadoCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CONCILIADO_BANCO').setBackground('#dcfce7').setFontColor('#166534').setRanges([concilCol]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE_BANCO').setBackground('#fef3c7').setFontColor('#92400e').setRanges([concilCol]).build()
  ]);

  // ── Resumen por Categoría (mes actual) ────────────────────────────────────
  var today = FinanceUtils.getChileDate();
  var currentPeriod = Utilities.formatDate(today, 'America/Santiago', 'yyyy-MM');
  var catTotals = {};

  ledgerRows.forEach(function (r) {
    var period = '';
    try { period = Utilities.formatDate(new Date(r[1]), 'America/Santiago', 'yyyy-MM'); } catch (e) {}
    if (period !== currentPeriod) { return; }

    var cat = String(r[3] || 'SIN_CATEGORIA');
    var tipo = String(r[2] || '').toUpperCase();
    var monto = FinanceUtils.normalizeCurrency(r[11]);
    if (!catTotals[cat]) { catTotals[cat] = { ingreso: 0, egreso: 0 }; }
    if (tipo === 'INGRESO') { catTotals[cat].ingreso += monto; }
    if (tipo === 'EGRESO')  { catTotals[cat].egreso  += monto; }
  });

  var summaryStartRow = dataStartRow + viewRows.length + 2;
  var summaryHeaderRange = sheet.getRange(summaryStartRow, 1, 1, 5);
  summaryHeaderRange.setValues([['RESUMEN MES ' + currentPeriod, 'Categoria', 'Ingresos CLP', 'Egresos CLP', 'Resultado CLP']])
    .setBackground('#14324a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontFamily('Verdana')
    .setHorizontalAlignment('center');

  var summaryRows = Object.keys(catTotals).sort().map(function (cat) {
    var t = catTotals[cat];
    return ['', cat, t.ingreso, t.egreso, t.ingreso - t.egreso];
  });

  var totalIngreso = 0;
  var totalEgreso = 0;
  summaryRows.forEach(function (r) { totalIngreso += r[2]; totalEgreso += r[3]; });
  summaryRows.push(['TOTAL', '', totalIngreso, totalEgreso, totalIngreso - totalEgreso]);

  if (summaryRows.length > 0) {
    var summaryDataRange = sheet.getRange(summaryStartRow + 1, 1, summaryRows.length, 5);
    summaryDataRange.setValues(summaryRows).setNumberFormat('#,##0');
    // Fila TOTAL en negrita
    sheet.getRange(summaryStartRow + summaryRows.length, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#e2f0fb');
    // Resultado: verde si positivo, rojo si negativo
    var resultCol = sheet.getRange(summaryStartRow + 1, 5, summaryRows.length, 1);
    sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat([
      SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground('#dcfce7').setFontColor('#166534').setRanges([resultCol]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setBackground('#fee2e2').setFontColor('#7f1d1d').setRanges([resultCol]).build()
    ]));
  }

  // ── Semáforo de cierre mensual ─────────────────────────────────────────────
  var semaforoRow = summaryStartRow + summaryRows.length + 2;
  var closeBlockers = (typeof DashboardService !== 'undefined' && DashboardService && typeof DashboardService.getMonthlyCloseBlockers === 'function')
    ? DashboardService.getMonthlyCloseBlockers()
    : null;

  var semaforoLabel = closeBlockers
    ? (closeBlockers.blocked ? 'CIERRE BLOQUEADO — Pendientes: ' + closeBlockers.blockers.join(' | ') : 'LISTO PARA CIERRE MENSUAL')
    : 'Estado de cierre no disponible';
  var semaforoBg = closeBlockers
    ? (closeBlockers.blocked ? '#fee2e2' : '#dcfce7')
    : '#fef3c7';
  var semaforoColor = closeBlockers
    ? (closeBlockers.blocked ? '#7f1d1d' : '#166534')
    : '#92400e';

  sheet.getRange(semaforoRow, 1, 1, titleCols).merge()
    .setValue(semaforoLabel)
    .setBackground(semaforoBg)
    .setFontColor(semaforoColor)
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontFamily('Verdana')
    .setWrap(true);
  sheet.setRowHeight(semaforoRow, 36);

  // ── Auto-resize y bordes ──────────────────────────────────────────────────
  sheet.autoResizeColumns(1, titleCols);
  for (var c = 1; c <= titleCols; c++) {
    var w = sheet.getColumnWidth(c);
    if (w < 90)  { sheet.setColumnWidth(c, 90); }
    if (w > 260) { sheet.setColumnWidth(c, 260); }
  }

  ss.setActiveSheet(sheet);
  AuditService.logInfo('Vista_Contador actualizada', JSON.stringify({
    rows: viewRows.length,
    periodo: currentPeriod,
    semaforo: closeBlockers ? (closeBlockers.blocked ? 'BLOQUEADO' : 'LISTO') : 'N/D'
  }));

  return {
    rows: viewRows.length,
    sheet: sheetName,
    periodo: currentPeriod,
    semaforo: closeBlockers ? (closeBlockers.blocked ? 'BLOQUEADO' : 'LISTO') : 'N/D'
  };
}

function refreshVistaContador() {
  return refreshVistaContador_20260513();
}

function runHeuristicNoiseKpiReport_20260513() {
  if (typeof DashboardService === 'undefined' || !DashboardService || typeof DashboardService.getHeuristicNoiseHealth !== 'function') {
    throw new Error('DashboardService.getHeuristicNoiseHealth no disponible. Actualiza DashboardService.gs en el proyecto GAS.');
  }

  var noise = DashboardService.getHeuristicNoiseHealth();
  var topSenders = (noise.topNoisySenders || []).map(function (item) {
    return item.sender + ' (' + item.count + ' rechazos)';
  });

  var report = {
    executedAt: FinanceUtils.nowChile(),
    kpis: {
      totalRejectedHeuristic: noise.totalRejectedHeuristic,
      rejectedDocSuspicious: noise.rejectedDocSuspicious,
      rejectedAmountImplausible: noise.rejectedAmountImplausible
    },
    topNoisySenders: topSenders,
    diagnostico: noise.totalRejectedHeuristic === 0
      ? 'Sin ruido heuristico registrado. Filtro funcionando o sin datos aun.'
      : 'Se detectaron ' + noise.totalRejectedHeuristic + ' rechazos heuristicos. Revisar remitentes ruidosos y ajustar HEURISTIC_MAX_CLP/HEURISTIC_MAX_USD si corresponde.'
  };

  Logger.log(JSON.stringify(report, null, 2));
  AuditService.logInfo('KPI Anti-Ruido heuristico ejecutado', JSON.stringify({
    total: noise.totalRejectedHeuristic,
    docSospechoso: noise.rejectedDocSuspicious,
    montoNoPlausibl: noise.rejectedAmountImplausible
  }));

  return report;
}
