# SOP Operativo Finanzas (1 Pagina)

## Objetivo
Asegurar que la automatizacion financiera de VITTOSTORE opere sin interrupciones y detectar incidentes de forma temprana.

## Tiempo total estimado
10 minutos por dia habil.

## Rutina diaria (Lunes a Viernes, 09:30)
1. Abrir Apps Script > Ejecuciones.
2. Verificar que estas funciones aparezcan como Completada:
   - runFinancialIngestion
   - runDailyFxRate
   - runDailyCompliance
3. Abrir dashboard financiero y validar:
   - pendingRejected estable
   - blockingIncidents en 0
4. Si hay error:
   - Copiar mensaje exacto de la ejecucion.
   - Registrar en Contingencia_Integraciones.
   - Escalar segun severidad (ver Semaforo).

## Rutina semanal (Lunes, 11:30)
1. Confirmar ejecucion de:
   - runWeeklyCEOReport
   - runWeeklyBankReconciliation
   - runWeeklyDataQualitySummary
   - runWeeklyIntegrationContingencySummary
   - runExecutiveDashboardRefresh
2. Revisar rechazos pendientes mayores a 7 dias.
3. Si hay acumulacion, ejecutar manualmente:
   - syncRejectedReviewQueue
   - processRejectedReviewQueue

## Rutina mensual (Ultimo dia habil, 22:30)
1. Confirmar ejecucion de runMonthlyBalance.
2. Validar que no existan errores en esa corrida.
3. Confirmar dashboard actualizado post cierre.

## Semaforo de severidad
- Rojo (SEV-1): riesgo tributario o datos contables comprometidos.
  - Accion: escalar inmediato a CEO y responsable financiero.
- Naranja (SEV-2): flujo critico detenido (ej. ingestion falla 2 veces seguidas).
  - Accion: escalar en menos de 30 minutos.
- Amarillo (SEV-3): degradacion parcial con workaround.
  - Accion: corregir en el dia y monitorear.
- Verde (SEV-4): alerta informativa sin impacto.
  - Accion: registrar y seguir monitoreo.

## Contingencia rapida (si falla runtime)
1. Ejecutar debugSetupBuildTag_20260508.
2. Ejecutar runPhase4RuntimeDiagnostics_20260508.
3. Si aparecen missing o undefined:
   - Re-sincronizar con clasp push -f.
   - Ejecutar onOpen y recargar la hoja.
   - Reintentar runFinancialIngestion.

## KPI de control
1. Exito diario de jobs >= 95%.
2. blockingIncidents = 0.
3. Rechazados pendientes > 7 dias = 0.

## Criterio contable rapido (devolucion, NC, import/export)
1. Nota de Credito / devolucion: TipoMovimiento esperado = EGRESO.
2. Exportacion: Categoria esperada = EXPORTACIONES.
3. Importacion: Categoria esperada = IMPORTACIONES y TipoMovimiento esperado = EGRESO.
4. En importaciones, validar subcategoria:
   - ARANCEL_ADUANERO
   - IMPUESTOS_IMPORTACION
   - LOGISTICA_Y_RETIRO_PORTUARIO
5. Arriendo vehiculos: OPERACIONES_Y_LOGISTICA / ARRIENDO_VEHICULOS.
6. Caja chica y rendiciones: GASTOS_OPERACIONALES / CAJA_CHICA_Y_RENDICIONES.
7. Si la clasificacion no coincide, registrar incidente y aplicar ajuste trazable (sin borrar historico).

## Cierre del dia
1. Jobs diarios completados.
2. Sin errores criticos abiertos.
3. Dashboard actualizado.
