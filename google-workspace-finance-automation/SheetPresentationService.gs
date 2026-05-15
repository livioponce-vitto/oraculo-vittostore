var SheetPresentationService = (function () {

  var BRAND = {
    NAVY:       '#16324f',
    SLATE:      '#334155',
    GRAY:       '#475569',
    DARK:       '#1e293b',
    WHITE:      '#ffffff',
    ROW_ODD:    '#ffffff',
    ROW_EVEN:   '#f8fafc',
    BORDER:     '#cbd5e1'
  };

  function getSheet(sheetName, headers) {
    return LedgerService.getOrCreateSheet(sheetName, headers);
  }

  function applyHeaderStyle(sheet, headers, background, fontColor) {
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground(background)
      .setFontColor(fontColor)
      .setFontWeight('bold')
      .setFontFamily('Montserrat')
      .setFontSize(11)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(1, 32);
    sheet.setFrozenRows(1);
  }

  function autoResizeWithLimits(sheet, columnCount) {
    sheet.autoResizeColumns(1, columnCount);
    for (var c = 1; c <= columnCount; c++) {
      var w = sheet.getColumnWidth(c);
      if (w < 110) sheet.setColumnWidth(c, 110);
      if (w > 280) sheet.setColumnWidth(c, 280);
    }
  }

  function clearBandings(sheet) {
    sheet.getBandings().forEach(function (b) { b.remove(); });
  }

  // Alternating rows: blanco / gris muy claro — reduce fatiga visual en tablas largas
  function applyBanding(sheet, headers) {
    clearBandings(sheet);
    var maxRows = sheet.getMaxRows();
    if (maxRows < 2) return;
    var banding = sheet.getRange(2, 1, maxRows - 1, headers.length).applyRowBanding();
    banding.setFirstRowColor(BRAND.ROW_ODD);
    banding.setSecondRowColor(BRAND.ROW_EVEN);
  }

  function applyDataStyle(sheet, headers) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var dataRows = lastRow - 1;
    sheet.getRange(2, 1, dataRows, headers.length)
      .setFontFamily('Montserrat')
      .setFontSize(10)
      .setWrap(true)
      .setVerticalAlignment('middle');
    sheet.setRowHeights(2, dataRows, 26);
  }

  function clearConditionalRules(sheet) {
    sheet.setConditionalFormatRules([]);
  }

  function applyExecutiveTableTheme(sheet, headers, tabColor) {
    applyHeaderStyle(sheet, headers, BRAND.NAVY, BRAND.WHITE);
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor(tabColor);
    applyDataStyle(sheet, headers);
    applyBanding(sheet, headers);
  }

  function parseDashboardDateValue_(value) {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
      return value;
    }
    var raw = String(value || '').trim();
    if (!raw || raw === 'N/D') return null;
    var parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
    parsed = new Date(raw.replace(' ', 'T'));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function applyDashboardUnitFormattingByIndicator_(sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var moneyIndicators    = { IngresosMes: true, EgresosMes: true, ResultadoMes: true };
    var datetimeIndicators = { ActualizadoEn: true, UltimaIngestion: true, UltimoControlCalidad: true };

    rows.forEach(function (row, idx) {
      var indicator  = String(row[1] || '');
      var value      = row[2];
      var valueRange = sheet.getRange(idx + 2, 3, 1, 1);

      if (datetimeIndicators[indicator]) {
        var dt = parseDashboardDateValue_(value);
        if (dt) { valueRange.setValue(dt); valueRange.setNumberFormat('yyyy-mm-dd hh:mm:ss'); }
        else    { valueRange.setNumberFormat('@'); }
        return;
      }

      var normalized = FinanceUtils.normalizeCurrency(value);
      if (moneyIndicators[indicator]) {
        valueRange.setValue(Math.round(normalized));
        valueRange.setNumberFormat('$#,##0');
        return;
      }

      if (String(value || '').trim() !== '' && !isNaN(normalized)) {
        valueRange.setValue(Math.round(normalized));
        valueRange.setNumberFormat('#,##0');
      } else {
        valueRange.setNumberFormat('@');
      }
    });
  }

  function applyDashboardFormatting() {
    var sheets = [
      { name: FinanceConfig.SHEETS.EXECUTIVE_DASHBOARD, headers: FinanceConfig.HEADERS.EXECUTIVE_DASHBOARD, color: '#0f766e' },
      { name: FinanceConfig.SHEETS.FINANCE_VIEW,        headers: FinanceConfig.HEADERS.FINANCE_VIEW,        color: '#1d4ed8' },
      { name: FinanceConfig.SHEETS.COMMERCIAL_VIEW,     headers: FinanceConfig.HEADERS.COMMERCIAL_VIEW,     color: '#b45309' },
      { name: FinanceConfig.SHEETS.MANAGEMENT_VIEW,     headers: FinanceConfig.HEADERS.MANAGEMENT_VIEW,     color: '#7c3aed' }
    ];
    sheets.forEach(function (cfg) {
      var sheet = getSheet(cfg.name, cfg.headers);
      applyExecutiveTableTheme(sheet, cfg.headers, cfg.color);
      applyDashboardUnitFormattingByIndicator_(sheet);
    });
  }

  function applyQueueFormatting() {
    var headers = FinanceConfig.HEADERS.REVIEW_QUEUE;
    var sheet   = getSheet(FinanceConfig.SHEETS.REVIEW_QUEUE, headers);

    applyHeaderStyle(sheet, headers, BRAND.SLATE, BRAND.WHITE);
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor('#dc2626');
    applyDataStyle(sheet, headers);
    applyBanding(sheet, headers);

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 18, sheet.getLastRow() - 1, 3)
        .setNumberFormat('$#,##0.##')
        .setHorizontalAlignment('right');
    }

    clearConditionalRules(sheet);
    var maxRows       = Math.max(sheet.getMaxRows() - 1, 1);
    var semaphoreRange = sheet.getRange(2, 32, maxRows, 1);
    var statusRange    = sheet.getRange(2, 8,  maxRows, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ROJO').setBackground('#fee2e2').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('AMARILLO').setBackground('#fef3c7').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('VERDE').setBackground('#dcfce7').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('REPROCESADO_OK').setBackground('#dcfce7').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BLOQUEADO').setBackground('#fee2e2').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE').setBackground('#fef3c7').setRanges([statusRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
    sheet.getRange(2, 1, maxRows, headers.length)
      .setBorder(true, true, true, true, false, false, BRAND.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  }

  function applyLedgerFormatting() {
    var headers = FinanceConfig.HEADERS.LEDGER;
    var sheet   = getSheet(FinanceConfig.SHEETS.LEDGER, headers);
    var lastRow = sheet.getLastRow();

    applyHeaderStyle(sheet, headers, BRAND.NAVY, BRAND.WHITE);
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor('#0369a1');
    applyDataStyle(sheet, headers);
    applyBanding(sheet, headers);

    if (lastRow < 2) return;
    var dataRows = lastRow - 1;

    // Montos CLP enteros con $ y alineación derecha
    sheet.getRange(2, 10, dataRows, 3).setNumberFormat('$#,##0').setHorizontalAlignment('right');
    sheet.getRange(2, 29, dataRows, 1).setNumberFormat('$#,##0').setHorizontalAlignment('right');
    // MontoOriginal: CLP o USD (hasta 2 dec)
    sheet.getRange(2, 27, dataRows, 1).setNumberFormat('$#,##0.##').setHorizontalAlignment('right');
    // TipoCambioAplicado: ratio sin $
    sheet.getRange(2, 28, dataRows, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');

    // Formato condicional: TipoMovimiento (col 3) y EstadoConciliacionBanco (col 30)
    clearConditionalRules(sheet);
    var maxRows        = Math.max(sheet.getMaxRows() - 1, 1);
    var tipoRange      = sheet.getRange(2, 3,  maxRows, 1);
    var conciliadoRange = sheet.getRange(2, 30, maxRows, 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('INGRESO').setBackground('#dcfce7').setFontColor('#166534').setRanges([tipoRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('EGRESO').setBackground('#fee2e2').setFontColor('#991b1b').setRanges([tipoRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CONCILIADO_BANCO').setBackground('#dcfce7').setRanges([conciliadoRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE_BANCO').setBackground('#fef3c7').setRanges([conciliadoRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
  }

  function applyFxRatesFormatting() {
    var sheet = getSheet(FinanceConfig.SHEETS.FX_RATES, FinanceConfig.HEADERS.FX_RATES);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    sheet.getRange(2, 2, lastRow - 1, 1).setNumberFormat('#,##0.00').setHorizontalAlignment('right');
  }

  // Auditoría: colores de severidad en fila completa (no solo celda)
  function applyAuditFormatting() {
    var headers = FinanceConfig.HEADERS.AUDIT;
    var sheet   = getSheet(FinanceConfig.SHEETS.AUDIT, headers);

    applyHeaderStyle(sheet, headers, BRAND.DARK, BRAND.WHITE);
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor('#64748b');
    applyDataStyle(sheet, headers);
    applyBanding(sheet, headers);

    clearConditionalRules(sheet);
    var maxRows   = Math.max(sheet.getMaxRows() - 1, 1);
    var fullRange = sheet.getRange(2, 1, maxRows, headers.length);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$B2="ERROR"')
        .setBackground('#fee2e2').setFontColor('#991b1b')
        .setRanges([fullRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$B2="WARN"')
        .setBackground('#fef3c7').setFontColor('#92400e')
        .setRanges([fullRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$B2="INFO"')
        .setBackground('#dbeafe').setFontColor('#1e40af')
        .setRanges([fullRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
  }

  function applyControlSheetFormatting(sheetName, headers, tabColor, severityColumn) {
    var sheet = getSheet(sheetName, headers);
    applyHeaderStyle(sheet, headers, BRAND.GRAY, BRAND.WHITE);
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor(tabColor);
    applyDataStyle(sheet, headers);
    applyBanding(sheet, headers);

    if (severityColumn) {
      clearConditionalRules(sheet);
      var maxRows       = Math.max(sheet.getMaxRows() - 1, 1);
      var severityRange = sheet.getRange(2, severityColumn, maxRows, 1);
      var rules = [
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ERROR').setBackground('#fee2e2').setRanges([severityRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('WARN').setBackground('#fef3c7').setRanges([severityRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('SEV-1').setBackground('#7f1d1d').setFontColor('#ffffff').setRanges([severityRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('SEV-2').setBackground('#dc2626').setFontColor('#ffffff').setRanges([severityRange]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('SEV-3').setBackground('#f59e0b').setFontColor('#111827').setRanges([severityRange]).build()
      ];
      sheet.setConditionalFormatRules(rules);
    }
  }

  function applyAllPresentation() {
    LedgerService.ensureCoreSheets();
    applyDashboardFormatting();
    applyQueueFormatting();
    applyLedgerFormatting();
    applyFxRatesFormatting();
    applyAuditFormatting();
    applyControlSheetFormatting(FinanceConfig.SHEETS.DATA_QUALITY,             FinanceConfig.HEADERS.DATA_QUALITY,             '#7c2d12', 4);
    applyControlSheetFormatting(FinanceConfig.SHEETS.REJECTED_RECORDS,         FinanceConfig.HEADERS.REJECTED_RECORDS,         '#991b1b', 6);
    applyControlSheetFormatting(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY,  FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY,  '#1f2937', 4);
    AuditService.logInfo('Formato visual aplicado', 'Montserrat + banding + Libro_Mayor + Auditoria');
    return { status: 'ok' };
  }

  return {
    applyAllPresentation: applyAllPresentation
  };
})();

// Wrapper global — disponible en el desplegable de Apps Script
function runApplyPresentation() {
  SheetPresentationService.applyAllPresentation();
  SpreadsheetApp.getUi().alert('✅ Formato visual aplicado a todas las hojas.\n\nMontserrat · Banding · Libro_Mayor · Auditoría · Semáforos');
}
