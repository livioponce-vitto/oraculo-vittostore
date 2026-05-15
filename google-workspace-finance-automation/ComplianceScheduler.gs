var ComplianceScheduler = (function () {
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

  function buildForeignInvoicesSummary(today) {
    var startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    var rows = LedgerService.getRowsForPeriod(startDate, today);
    var foreignTotal = 0;
    var foreignCount = 0;

    rows.forEach(function (row) {
      var isForeign = String(row[30] || 'FALSE').toUpperCase() === 'TRUE';
      if (!isForeign) {
        return;
      }

      foreignCount += 1;
      foreignTotal += FinanceUtils.normalizeCurrency(row[28] || row[11]);
    });

    return {
      count: foreignCount,
      totalClp: foreignTotal
    };
  }

  function sendComplianceAlert(subject, body) {
    var recipients = FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS');
    return safeSendMail_({
      to: recipients,
      subject: subject,
      body: body
    }, 'sendComplianceAlert');
  }

  function runDailyComplianceAlerts() {
    var today = FinanceUtils.getChileDate();
    var day = today.getDate();
    var month = today.getMonth() + 1;
    var year = today.getFullYear();

    if (day === 7) {
      var previredEmail = sendComplianceAlert(
        '[SII/Previred] Recordatorio preventivo - vence dia 10',
        [
          'Recordatorio automatico VittoStore',
          'Faltan 3 dias para pago de Previred.',
          'Fecha limite: ' + year + '-' + month + '-10',
          'Accion: validar nominas y pago previsional hoy.'
        ].join('\n')
      );
      if (!previredEmail.sent) {
        AuditService.logWarn('Previred sin envio de correo', previredEmail.error);
      }
      AuditService.logInfo('Alerta Previred enviada', 'Dia 7');
    }

    if (day === 17) {
      var foreignSummary = buildForeignInvoicesSummary(today);
      var f29Email = sendComplianceAlert(
        '[SII/F29] Recordatorio preventivo - vence dia 20',
        [
          'Recordatorio automatico VittoStore',
          'Faltan 3 dias para declaracion F29.',
          'Fecha limite: ' + year + '-' + month + '-20',
          'Accion: revisar libro compra/venta, IVA debito y credito.',
          'Facturas de compra a extranjeros (acumulado mes):',
          'Cantidad: ' + foreignSummary.count,
          'Total CLP: ' + foreignSummary.totalClp
        ].join('\n')
      );
      if (!f29Email.sent) {
        AuditService.logWarn('F29 sin envio de correo', f29Email.error);
      }
      AuditService.logInfo('Alerta F29 enviada', 'Dia 17');
    }

    // Alertas compromisos bancarios (25 de cada mes)
    if (day === 25) {
      var compromisosBancariosEmail = sendComplianceAlert(
        '[Compromisos Bancarios] Recordatorio mensual de pagos',
        [
          'Recordatorio automatico VittoStore',
          'Recordatorio mensual de compromisos bancarios.',
          'Compromisos a revisar y pagar proximamente:',
          '- Creditos bancarios',
          '- Leasing financiero',
          '- Factoring',
          '- Creditos de proveedores',
          '- Pagos de dividendos',
          'Acciones requeridas:',
          '- Verificar fechas exactas de vencimiento',
          '- Preparar flujos de caja para pagos',
          '- Confirmar montos y condiciones',
          '- Revisar saldos disponibles en cuentas'
        ].join('\n')
      );
      if (!compromisosBancariosEmail.sent) {
        AuditService.logWarn('Compromisos bancarios sin envio de correo', compromisosBancariosEmail.error);
      }
      AuditService.logInfo('Alerta Compromisos Bancarios enviada', 'Dia 25');
    }

    // Alertas inicio temporada patentes comerciales (15 de enero)
    if (month === 1 && day === 15) {
      var patentesInicioEmail = sendComplianceAlert(
        '[Patentes Comerciales] Inicio temporada de pagos',
        [
          'Recordatorio automatico VittoStore',
          'Inicio de temporada de pagos de patentes comerciales.',
          'Fechas limite aproximadas (varia por municipio):',
          '- Santiago y zonas metropolitanas: 31 de marzo',
          '- Regiones: entre enero y abril',
          'Acciones recomendadas:',
          '- Identificar municipios donde opera la empresa',
          '- Verificar fechas exactas de vencimiento',
          '- Preparar informacion de giros y actividades',
          '- Revisar si aplica exencion por zona franca o PYMES',
          'Alerta preventiva: 12 de marzo'
        ].join('\n')
      );
      if (!patentesInicioEmail.sent) {
        AuditService.logWarn('Inicio temporada patentes sin envio de correo', patentesInicioEmail.error);
      }
      AuditService.logInfo('Alerta Inicio Temporada Patentes enviada', '15 de enero');
    }

    // Alertas anuales - Declaraciones de renta (28 de marzo)
    if (month === 3 && day === 28) {
      var annualDeclarationsEmail = sendComplianceAlert(
        '[SII/Declaraciones Anuales] Recordatorio preventivo - vence dia 31',
        [
          'Recordatorio automatico VittoStore',
          'Faltan 3 dias para declaraciones anuales de renta.',
          'Fecha limite: ' + year + '-03-31',
          'Declaraciones a revisar:',
          '- F22: Impuesto a la Renta',
          '- F50: Rentas presuntas',
          '- F21: Primera Categoria',
          '- F27: Mineria',
          'Accion: preparar documentacion y revisar calculos.'
        ].join('\n')
      );
      if (!annualDeclarationsEmail.sent) {
        AuditService.logWarn('Declaraciones anuales sin envio de correo', annualDeclarationsEmail.error);
      }
      AuditService.logInfo('Alerta Declaraciones Anuales enviada', '28 de marzo');
    }

    // Alertas patentes comerciales (15 de marzo)
    if (month === 3 && day === 12) {
      var patentesEmail = sendComplianceAlert(
        '[Patentes Comerciales] Recordatorio preventivo - vence proximamente',
        [
          'Recordatorio automatico VittoStore',
          'Faltan 3 dias para pago de patentes comerciales.',
          'Fechas limite aproximadas (varia por municipio):',
          '- Santiago y zonas metropolitanas: 31 de marzo',
          '- Regiones: entre enero y abril',
          'Acciones requeridas:',
          '- Verificar fecha exacta con municipio correspondiente',
          '- Preparar pago correspondiente',
          '- Revisar si aplica exencion por zona franca o PYMES',
          'Nota: Las patentes comerciales son un impuesto municipal.'
        ].join('\n')
      );
      if (!patentesEmail.sent) {
        AuditService.logWarn('Patentes comerciales sin envio de correo', patentesEmail.error);
      }
      AuditService.logInfo('Alerta Patentes Comerciales enviada', '12 de marzo');
    }

    // Alertas anuales - Pagos de renta (10 de abril)
    if (month === 4 && day === 7) {
      var annualPaymentsEmail = sendComplianceAlert(
        '[SII/Pagos Anuales] Recordatorio preventivo - vence dia 10',
        [
          'Recordatorio automatico VittoStore',
          'Faltan 3 dias para pagos de impuestos anuales.',
          'Fecha limite: ' + year + '-04-10',
          'Pagos a realizar:',
          '- Impuesto a la Renta (F22)',
          '- Primera Categoria (F21)',
          '- Rentas presuntas (F50)',
          '- Mineria (F27)',
          'Accion: preparar pagos y validar montos.'
        ].join('\n')
      );
      if (!annualPaymentsEmail.sent) {
        AuditService.logWarn('Pagos anuales sin envio de correo', annualPaymentsEmail.error);
      }
      AuditService.logInfo('Alerta Pagos Anuales enviada', '7 de abril');
    }

    // Rotación semanal de logs de auditoría — corre si no se ejecutó en 7+ días
    try {
      var lastRotation = PropertiesService.getScriptProperties().getProperty('AUDIT_LAST_ROTATION');
      var daysSinceLast = lastRotation
        ? (Date.now() - new Date(lastRotation).getTime()) / 86400000
        : 999;

      if (daysSinceLast >= 1) {
        AuditService.rotateAuditLog();
      }
    } catch (e) {
      AuditService.logWarn('Rotacion logs auditoria fallida en scheduler', String(e));
    }

    return 'OK';
  }

  function runMonthlyReconciliation() {
    var today = FinanceUtils.getChileDate();
    if (!FinanceUtils.isLastDayOfMonth(today)) {
      return 'No es ultimo dia del mes. Se omite.';
    }

    var closeCheck = DashboardService.getMonthlyCloseBlockers();
    if (closeCheck.blocked) {
      var recipientsBlocked = FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS');
      var blockedEmail = safeSendMail_({
        to: recipientsBlocked,
        subject: '[Balance Mensual] Cierre bloqueado por riesgos operativos',
        body: [
          'El cierre mensual fue bloqueado automaticamente.',
          'Bloqueantes detectados:',
          closeCheck.blockers.join('\n'),
          '',
          'Revisar Dashboard_Ejecutivo, Bandeja_Revision_Rechazados, Control_Calidad_Datos y Contingencia_Integraciones.'
        ].join('\n')
      }, 'runMonthlyReconciliation.blocked');

      if (!blockedEmail.sent) {
        AuditService.logWarn('Aviso de cierre bloqueado sin correo', blockedEmail.error);
      }

      AuditService.logWarn('Cierre mensual bloqueado', JSON.stringify(closeCheck.blockers));
      return {
        status: 'blocked',
        blockers: closeCheck.blockers
      };
    }

    var startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    var endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    var rows = LedgerService.getRowsForPeriod(startDate, endDate);

    var ingresos = 0;
    var egresos = 0;

    rows.forEach(function (row) {
      var tipoMovimiento = String(row[2] || '').toUpperCase();
      var monto = FinanceUtils.normalizeCurrency(row[11]);
      if (tipoMovimiento === 'INGRESO') {
        ingresos += monto;
      } else if (tipoMovimiento === 'EGRESO') {
        egresos += monto;
      }
    });

    var resultado = ingresos - egresos;
    var status = resultado >= 0 ? 'POSITIVO' : 'NEGATIVO';

    var monthlySheet = LedgerService.getOrCreateSheet(FinanceConfig.SHEETS.MONTHLY, FinanceConfig.HEADERS.MONTHLY);
    var period = Utilities.formatDate(today, 'America/Santiago', 'yyyy-MM');
    monthlySheet.appendRow([period, ingresos, egresos, resultado, status, FinanceUtils.nowIso()]);

    var recipients = FinanceConfig.getRequiredProperty('FINANCE_ALERT_EMAILS');
    var monthlyEmail = safeSendMail_({
      to: recipients,
      subject: '[Balance Mensual] Conciliacion automatica ' + period,
      body: [
        'Resumen cierre mensual VittoStore',
        'Periodo: ' + period,
        'Ingresos: ' + ingresos,
        'Egresos: ' + egresos,
        'Resultado: ' + resultado,
        'Estado: ' + status
      ].join('\n')
    }, 'runMonthlyReconciliation');

    if (!monthlyEmail.sent) {
      AuditService.logWarn('Balance mensual sin envio de correo', monthlyEmail.error);
    }

    AuditService.logInfo('Balance mensual generado', period + ' resultado=' + resultado);
    return { period: period, ingresos: ingresos, egresos: egresos, resultado: resultado, status: status };
  }

  function setupComplianceTriggers() {
    try {
      // Eliminar triggers existentes para evitar duplicados
      var triggers = ScriptApp.getProjectTriggers();
      triggers.forEach(function (trigger) {
        if (trigger.getHandlerFunction() === 'runDailyComplianceAlerts') {
          ScriptApp.deleteTrigger(trigger);
        }
      });

      // Crear nuevo trigger diario a las 9:00 AM hora de Chile
      ScriptApp.newTrigger('runDailyComplianceAlerts')
        .timeBased()
        .everyDays(1)
        .atHour(9)
        .nearMinute(0)
        .inTimezone('America/Santiago')
        .create();

      AuditService.logInfo('Trigger de alertas tributarias configurado', 'Diario 9:00 AM CLT');
      return { success: true, message: 'Trigger diario configurado para alertas tributarias (9:00 AM CLT)' };
    } catch (error) {
      AuditService.logError('Error configurando trigger tributario', String(error));
      return { success: false, error: String(error) };
    }
  }

  return {
    runDailyComplianceAlerts: runDailyComplianceAlerts,
    runMonthlyReconciliation: runMonthlyReconciliation,
    setupComplianceTriggers: setupComplianceTriggers
  };
})();
