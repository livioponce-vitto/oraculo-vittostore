var SheetSecurityService = (function () {
  var DESCRIPTION_PREFIX = 'VITTO_ROLE_PROTECTION';

  function uniqueEmails(emails) {
    var seen = {};
    return emails.filter(function (email) {
      var normalized = String(email || '').trim().toLowerCase();
      if (!normalized || seen[normalized]) {
        return false;
      }
      seen[normalized] = true;
      return true;
    });
  }

  function getFinanceEditors() {
    return FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS').split(',').map(function (email) {
      return email.trim();
    }).filter(Boolean);
  }

  function getCommercialEditors() {
    return FinanceConfig.getRequiredProperty('MARKETING_REPORT_EMAILS').split(',').map(function (email) {
      return email.trim();
    }).filter(Boolean);
  }

  function getManagementEditors() {
    return [FinanceConfig.getRequiredProperty('CEO_EMAIL')];
  }

  function getAdminEditors() {
    var effectiveUser = Session.getEffectiveUser().getEmail();
    return uniqueEmails(getFinanceEditors().concat(getManagementEditors()).concat([effectiveUser]));
  }

  function removeExistingProtections() {
    var spreadsheet = FinanceConfig.getSpreadsheet();
    [SpreadsheetApp.ProtectionType.SHEET, SpreadsheetApp.ProtectionType.RANGE].forEach(function (type) {
      spreadsheet.getProtections(type).forEach(function (protection) {
        if (String(protection.getDescription() || '').indexOf(DESCRIPTION_PREFIX) === 0) {
          protection.remove();
        }
      });
    });
  }

  function applyEditors(protection, editors) {
    var allowed = uniqueEmails(editors.concat(getAdminEditors()));
    protection.setDescription(DESCRIPTION_PREFIX + '|' + allowed.join(','));
    protection.setDomainEdit(false);

    var existingEditors = protection.getEditors().map(function (user) {
      return user.getEmail();
    });

    if (allowed.length > 0) {
      protection.addEditors(allowed);
    }

    var removable = existingEditors.filter(function (email) {
      return allowed.indexOf(email) === -1;
    });

    if (removable.length > 0) {
      protection.removeEditors(removable);
    }
  }

  function protectSheetForEditors(sheetName, headers, editors) {
    var sheet = LedgerService.getOrCreateSheet(sheetName, headers);
    var protection = sheet.protect();
    applyEditors(protection, editors);
  }

  function protectQueueOperationalRanges() {
    var sheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.REVIEW_QUEUE, FinanceConfig.HEADERS.REVIEW_QUEUE);
    var financeEditors = getFinanceEditors();
    var commercialEditors = getCommercialEditors();
    var queueEditors = uniqueEmails(financeEditors.concat(commercialEditors).concat(getManagementEditors()));
    var editableRange = sheet.getRange('J2:Z');

    var sheetProtection = sheet.protect();
    applyEditors(sheetProtection, queueEditors);
    sheetProtection.setUnprotectedRanges([editableRange]);

    var systemRangeProtection = sheet.getRange('A2:I').protect();
    applyEditors(systemRangeProtection, financeEditors);

    var outcomeRangeProtection = sheet.getRange('AA2:AG').protect();
    applyEditors(outcomeRangeProtection, financeEditors);
  }

  function applyRoleProtections() {
    LedgerService.ensureCoreSheets();
    removeExistingProtections();

    protectSheetForEditors(FinanceConfig.SHEETS.EXECUTIVE_DASHBOARD, FinanceConfig.HEADERS.EXECUTIVE_DASHBOARD, getManagementEditors().concat(getFinanceEditors()));
    protectSheetForEditors(FinanceConfig.SHEETS.FINANCE_VIEW, FinanceConfig.HEADERS.FINANCE_VIEW, getFinanceEditors());
    protectSheetForEditors(FinanceConfig.SHEETS.COMMERCIAL_VIEW, FinanceConfig.HEADERS.COMMERCIAL_VIEW, getCommercialEditors());
    protectSheetForEditors(FinanceConfig.SHEETS.MANAGEMENT_VIEW, FinanceConfig.HEADERS.MANAGEMENT_VIEW, getManagementEditors());
    protectSheetForEditors(FinanceConfig.SHEETS.DATA_QUALITY, FinanceConfig.HEADERS.DATA_QUALITY, getFinanceEditors());
    protectSheetForEditors(FinanceConfig.SHEETS.REJECTED_RECORDS, FinanceConfig.HEADERS.REJECTED_RECORDS, getFinanceEditors());
    protectSheetForEditors(FinanceConfig.SHEETS.INTEGRATION_CONTINGENCY, FinanceConfig.HEADERS.INTEGRATION_CONTINGENCY, getFinanceEditors().concat(getManagementEditors()));
    protectQueueOperationalRanges();

    AuditService.logInfo('Protecciones por rol aplicadas', 'Vistas ejecutivas y rangos sensibles protegidos');
    return { status: 'ok' };
  }

  return {
    applyRoleProtections: applyRoleProtections
  };
})();
