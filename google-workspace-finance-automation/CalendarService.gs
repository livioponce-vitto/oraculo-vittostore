var CalendarService = (function () {

  // Usa Script Property FINANCE_CALENDAR_NAME si existe; si no, el calendario principal.
  function getFinanceCalendar() {
    var name = FinanceConfig.getOptionalProperty('FINANCE_CALENDAR_NAME', '');
    if (name) {
      var calendars = CalendarApp.getCalendarsByName(name);
      if (calendars && calendars.length > 0) return calendars[0];
    }
    return CalendarApp.getDefaultCalendar();
  }

  // Evita duplicados: busca eventos con el mismo título en un rango de ±1 día.
  function eventAlreadyExists(calendar, title, targetDate) {
    var start = new Date(targetDate.getTime() - 86400000);
    var end   = new Date(targetDate.getTime() + 86400000);
    var existing = calendar.getEvents(start, end);
    return existing.some(function (e) { return e.getTitle() === title; });
  }

  function createEventSafe(calendar, title, startDate, endDate, description, popupMin, emailMin) {
    if (eventAlreadyExists(calendar, title, startDate)) {
      return { title: title, status: 'ya_existe' };
    }
    try {
      var event = calendar.createAllDayEvent(title, startDate);
      event.setDescription(description);
      if (popupMin > 0)  event.addPopupNotification(popupMin);
      if (emailMin > 0)  event.addEmailNotification(emailMin);
      return { title: title, status: 'creado' };
    } catch (e) {
      return { title: title, status: 'error', error: String(e) };
    }
  }

  // ── Evento semanal de revisión del Libro Mayor ────────────────────────────────

  function getNextMonday(date) {
    var d = new Date(date);
    var daysUntilMonday = (1 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    return d;
  }

  function createWeeklyReviewEvent() {
    var calendar   = getFinanceCalendar();
    var nextMonday = getNextMonday(new Date());
    var title      = '📊 Revisión Libro_Mayor — VITTOSTORE';
    var desc = [
      'Recordatorio automático VITTOSTORE Finance',
      '1. Revisar Libro_Mayor — ingresos/egresos nuevos',
      '2. Verificar Auditoria_Finanzas sin errores',
      '3. Validar tipo de cambio USD actualizado',
      '4. Revisar alertas SII si corresponde'
    ].join('\n');

    var result = createEventSafe(calendar, title, nextMonday, nextMonday, desc, 60, 1440);
    AuditService.logInfo('CalendarService evento semanal', JSON.stringify(result));
    return result;
  }

  function runWeeklyCalendarReminder() {
    try {
      return createWeeklyReviewEvent();
    } catch (error) {
      AuditService.logError('Fallo al crear evento Calendar semanal', String(error));
      return { status: 'error', error: String(error) };
    }
  }

  // ── Eventos de cumplimiento tributario para todo el año ───────────────────────

  /**
   * Crea todos los eventos de vencimiento tributario del año en Google Calendar.
   * Idem-potente: no duplica eventos ya existentes.
   * @param {number} [year]  Año a poblar (default: año actual en Chile)
   */
  function createComplianceCalendarEvents(year) {
    var calendar = getFinanceCalendar();
    var y        = year || FinanceUtils.getChileDate().getFullYear();
    var results  = [];

    // ── Eventos mensuales ──────────────────────────────────────────────────────
    for (var m = 0; m < 12; m++) {
      var monthName = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][m];

      // Previred — vence día 10
      var previredDate = new Date(y, m, 10);
      results.push(createEventSafe(
        calendar,
        '🏦 Previred ' + monthName + ' — Vence hoy',
        previredDate, previredDate,
        'Pago de cotizaciones previsionales (AFP, Salud, Cesantía).\nVerificar nóminas y ejecutar pago en previred.com',
        120, 2880  // popup 2h antes, email 2 días antes
      ));

      // F29 — vence día 20
      var f29Date = new Date(y, m, 20);
      results.push(createEventSafe(
        calendar,
        '📋 F29 SII ' + monthName + ' — Vence hoy',
        f29Date, f29Date,
        'Declaración mensual de IVA (Formulario 29).\nRevisar libro compra/venta, calcular IVA débito y crédito.\nDeclara en sii.cl > Servicios Online > Declarar y Pagar.',
        120, 2880
      ));

      // Compromisos bancarios — recordatorio día 25
      var bancosDate = new Date(y, m, 25);
      results.push(createEventSafe(
        calendar,
        '🏛 Compromisos Bancarios ' + monthName,
        bancosDate, bancosDate,
        'Revisar y pagar compromisos bancarios del mes:\n- Créditos bancarios\n- Leasing financiero\n- Factoring\nVerificar saldos disponibles.',
        60, 1440
      ));
    }

    // ── Eventos anuales ────────────────────────────────────────────────────────

    // Inicio temporada patentes — 15 enero
    results.push(createEventSafe(
      calendar,
      '🏢 Inicio Temporada Patentes Comerciales',
      new Date(y, 0, 15), new Date(y, 0, 15),
      'Inicio de temporada de pagos de patentes comerciales.\nFechas límite aprox:\n- Santiago y zona metropolitana: 31 de marzo\n- Regiones: entre enero y abril\nVerificar fecha exacta con municipio.',
      60, 4320
    ));

    // Patentes comerciales — vence ~31 marzo (recordatorio 12 marzo)
    results.push(createEventSafe(
      calendar,
      '🏢 Patentes Comerciales — Vence este mes',
      new Date(y, 2, 12), new Date(y, 2, 12),
      'Las patentes comerciales vencen aprox. el 31 de marzo.\nVerificar fecha exacta con municipio y preparar pago.',
      120, 2880
    ));

    // Declaración anual renta — vence 31 marzo
    results.push(createEventSafe(
      calendar,
      '📑 Declaración Anual Renta — Vence hoy (31 Mar)',
      new Date(y, 2, 31), new Date(y, 2, 31),
      'Presentar declaración anual de impuesto a la renta:\n- F22: Impuesto a la Renta\n- F50: Rentas presuntas\n- F21: Primera Categoría\nDeclara en sii.cl',
      120, 4320
    ));

    // Pago impuesto renta — vence 10 abril
    results.push(createEventSafe(
      calendar,
      '💸 Pago Anual Impuesto Renta — Vence hoy (10 Abr)',
      new Date(y, 3, 10), new Date(y, 3, 10),
      'Pagar impuestos anuales declarados:\n- F22, F21, F50\nVerificar montos y transferir a cuenta SII.',
      120, 4320
    ));

    var created = results.filter(function (r) { return r.status === 'creado'; }).length;
    var existed  = results.filter(function (r) { return r.status === 'ya_existe'; }).length;
    AuditService.logInfo('CalendarService compliance ' + y, 'creados=' + created + ' ya_existentes=' + existed);
    return { year: y, created: created, alreadyExisted: existed, total: results.length };
  }

  return {
    createWeeklyReviewEvent: createWeeklyReviewEvent,
    runWeeklyCalendarReminder: runWeeklyCalendarReminder,
    createComplianceCalendarEvents: createComplianceCalendarEvents
  };
})();

// ── Wrappers globales (dropdown de Apps Script) ───────────────────────────────

function runWeeklyCalendarReminder() {
  var result = CalendarService.runWeeklyCalendarReminder();
  SpreadsheetApp.getUi().alert(
    result.status === 'creado'
      ? '✅ Evento creado para el próximo lunes.'
      : result.status === 'ya_existe'
        ? 'ℹ️ Evento ya existe para ese lunes.'
        : '❌ Error: ' + result.error
  );
}

function runSetupComplianceCalendarEvents() {
  var result = CalendarService.createComplianceCalendarEvents();
  SpreadsheetApp.getUi().alert(
    '✅ Eventos tributarios ' + result.year + ' configurados.\n\n' +
    'Creados: ' + result.created + '\n' +
    'Ya existían: ' + result.alreadyExisted + '\n' +
    'Total: ' + result.total
  );
}
