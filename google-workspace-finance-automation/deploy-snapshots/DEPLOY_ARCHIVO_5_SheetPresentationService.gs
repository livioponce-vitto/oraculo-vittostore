var SheetPresentationService = (function () {
  function getSheet(sheetName, headers) {
    return LedgerService.getOrCreateSheet(sheetName, headers);
  }

  function applyHeaderStyle(sheet, headers, background, fontColor) {
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange
      .setBackground(background)
      .setFontColor(fontColor)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
  }

  function autoResizeWithLimits(sheet, columnCount) {
    sheet.autoResizeColumns(1, columnCount);
    for (var column = 1; column <= columnCount; column++) {
      var width = sheet.getColumnWidth(column);
      if (width < 110) {
        sheet.setColumnWidth(column, 110);
      }
      if (width > 280) {
        sheet.setColumnWidth(column, 280);
      }
    }
  }

  function clearConditionalRules(sheet) {
    sheet.setConditionalFormatRules([]);
  }

  function applyExecutiveTableTheme(sheet, headers, tabColor) {
    applyHeaderStyle(sheet, headers, '#16324f', '#ffffff');
    autoResizeWithLimits(sheet, headers.length);
    sheet.setFrozenRows(1);
    sheet.setTabColor(tabColor);

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
        .setFontFamily('Verdana')
        .setWrap(true)
        .setVerticalAlignment('middle');
    }
  }

  function applyDashboardFormatting() {
    var dashboardSheets = [
      { name: FinanceConfig.SHEETS.EXECUTIVE_DASHBOARD, headers: FinanceConfig.HEADERS.EXECUTIVE_DASHBOARD, color: '#0f766e' },
      { name: FinanceConfig.SHEETS.FINANCE_VIEW, headers: FinanceConfig.HEADERS.FINANCE_VIEW, color: '#1d4ed8' },
      { name: FinanceConfig.SHEETS.COMMERCIAL_VIEW, headers: FinanceConfig.HEADERS.COMMERCIAL_VIEW, color: '#b45309' },
      { name: FinanceConfig.SHEETS.MANAGEMENT_VIEW, headers: FinanceConfig.HEADERS.MANAGEMENT_VIEW, color: '#7c3aed' }
    ];

    dashboardSheets.forEach(function (config) {
      var sheet = getSheet(config.name, config.headers);
      applyExecutiveTableTheme(sheet, config.headers, config.color);

      if (sheet.getLastRow() > 1) {
        sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).setNumberFormat('#,##0.00');
      }
    });
  }

  function applyQueueFormatting() {
    var sheet = getSheet(FinanceConfig.SHEETS.REVIEW_QUEUE, FinanceConfig.HEADERS.REVIEW_QUEUE);
    applyHeaderStyle(sheet, FinanceConfig.HEADERS.REVIEW_QUEUE, '#334155', '#ffffff');
    autoResizeWithLimits(sheet, FinanceConfig.HEADERS.REVIEW_QUEUE.length);
    sheet.setTabColor('#dc2626');

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, FinanceConfig.HEADERS.REVIEW_QUEUE.length)
        .setFontFamily('Verdana')
        .setWrap(true)
        .setVerticalAlignment('middle');
      sheet.getRange(2, 18, sheet.getLastRow() - 1, 3).setNumberFormat('#,##0.00');
    }

    clearConditionalRules(sheet);
    var range = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), FinanceConfig.HEADERS.REVIEW_QUEUE.length);
    var semaphoreRange = sheet.getRange(2, 32, Math.max(sheet.getMaxRows() - 1, 1), 1);
    var statusRange = sheet.getRange(2, 8, Math.max(sheet.getMaxRows() - 1, 1), 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ROJO').setBackground('#fee2e2').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('AMARILLO').setBackground('#fef3c7').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('VERDE').setBackground('#dcfce7').setRanges([semaphoreRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('REPROCESADO_OK').setBackground('#dcfce7').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BLOQUEADO').setBackground('#fee2e2').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PENDIENTE').setBackground('#fef3c7').setRanges([statusRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
    range.setBorder(true, true, true, true, false, false, '#cbd5e1', SpreadsheetApp.BorderStyle.SOLID);
  }

  function applyControlSheetFormatting(sheetName, headers, tabColor, severityColumn) {
    var sheet = getSheet(sheetName, headers);
    applyHeaderStyle(sheet, headers, '#475569', '#ffffff');
    autoResizeWithLimits(sheet, headers.length);
    sheet.setTabColor(tabColor);

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
        .setFontFamily('Verdana')
        .setWrap(true);
    }

    if (severityColumn) {
      clearConditionalRules(sheet);
      var severityRange = sheet.getRange(2, severityColumn, Math.max(sheet.getMaxRows() - 1, 1), 1);
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
    applyControlSheetFormatting(FinanceConfig.SHEETS.DATA_QUALITY, FinanceConfig.HEADERS.DATA_QUALITY, '#7c2d12', 4);
    applyControlSheetFormatting(FinanceConfig.SHEETS.REJECTED_RECORDS, FinanceConfig.HEADERS.REJECTED_RECORDS, '#991b1b', 6);
    applyControlSheetFormatting(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY, '#1f2937', 4);
    AuditService.logInfo('Formato visual aplicado', 'Dashboards, bandejas y controles actualizados');
    return { status: 'ok' };
  }

  return {
    applyAllPresentation: applyAllPresentation
  };
})();
