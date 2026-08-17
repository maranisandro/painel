-- Convenção de nomenclatura de banco (padroes-dev/vault/padroes/nomenclatura-banco-dados.md)
-- Somente RENAME (tabelas e colunas) + ADD COLUMN (novas colunas nullable de
-- preparação multi-tenant). NUNCA DROP/CREATE — dados reais em produção
-- (histórico de GPS, auditoria, cadastros corrigidos manualmente).

-- ============================================================
-- 1) Renomear tabelas (PascalCase -> snake_case plural)
-- ============================================================

ALTER TABLE "User" RENAME TO users;
ALTER TABLE "AuditLog" RENAME TO audit_logs;
ALTER TABLE "DataSource" RENAME TO data_sources;
ALTER TABLE "Dataset" RENAME TO datasets;
ALTER TABLE "DatasetRow" RENAME TO dataset_rows;
ALTER TABLE "SyncSchedule" RENAME TO sync_schedules;
ALTER TABLE "SyncRun" RENAME TO sync_runs;
ALTER TABLE "ComputedColumn" RENAME TO computed_columns;
ALTER TABLE "Parameter" RENAME TO parameters;
ALTER TABLE "Module" RENAME TO modules;
ALTER TABLE "UserModuleAccess" RENAME TO user_module_accesses;
ALTER TABLE "Panel" RENAME TO panels;
ALTER TABLE "Location" RENAME TO locations;
ALTER TABLE "LocationVisit" RENAME TO location_visits;
ALTER TABLE "VehiclePosition" RENAME TO vehicle_positions;
ALTER TABLE "SpeedAlert" RENAME TO speed_alerts;
ALTER TABLE "PlateComposition" RENAME TO plate_compositions;
ALTER TABLE "Route" RENAME TO routes;
ALTER TABLE "RouteFreightPrice" RENAME TO route_freight_prices;
ALTER TABLE "VehicleMaintenance" RENAME TO vehicle_maintenances;
ALTER TABLE "DriverVacation" RENAME TO driver_vacations;
ALTER TABLE "TripJustification" RENAME TO trip_justifications;
ALTER TABLE "TripTicket" RENAME TO trip_tickets;
ALTER TABLE "CompositionSpec" RENAME TO composition_specs;
ALTER TABLE "ProductType" RENAME TO product_types;
ALTER TABLE "Fase3ClienteAcao" RENAME TO fase3_cliente_acoes;
ALTER TABLE "CriticaModeloAchado" RENAME TO critica_modelo_achados;

-- ============================================================
-- 2) Renomear colunas (camelCase -> snake_case)
-- ============================================================

ALTER TABLE users RENAME COLUMN "mustChangePassword" TO must_change_password;
ALTER TABLE users RENAME COLUMN "sessionVersion" TO session_version;
ALTER TABLE users RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE audit_logs RENAME COLUMN "userId" TO user_id;
ALTER TABLE audit_logs RENAME COLUMN "userName" TO user_name;
ALTER TABLE audit_logs RENAME COLUMN "entityId" TO entity_id;
ALTER TABLE audit_logs RENAME COLUMN "createdAt" TO created_at;

ALTER TABLE data_sources RENAME COLUMN "envPrefix" TO env_prefix;
ALTER TABLE data_sources RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE data_sources RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE datasets RENAME COLUMN "dataSourceId" TO data_source_id;
ALTER TABLE datasets RENAME COLUMN "primaryKeyFields" TO primary_key_fields;
ALTER TABLE datasets RENAME COLUMN "incrementalField" TO incremental_field;
ALTER TABLE datasets RENAME COLUMN "incrementalType" TO incremental_type;
ALTER TABLE datasets RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE datasets RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE dataset_rows RENAME COLUMN "datasetId" TO dataset_id;
ALTER TABLE dataset_rows RENAME COLUMN "syncedAt" TO synced_at;

ALTER TABLE sync_schedules RENAME COLUMN "datasetId" TO dataset_id;
ALTER TABLE sync_schedules RENAME COLUMN "intervalMinutes" TO interval_minutes;
ALTER TABLE sync_schedules RENAME COLUMN "lastRunAt" TO last_run_at;
ALTER TABLE sync_schedules RENAME COLUMN "nextRunAt" TO next_run_at;
ALTER TABLE sync_schedules RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE sync_runs RENAME COLUMN "datasetId" TO dataset_id;
ALTER TABLE sync_runs RENAME COLUMN "startedAt" TO started_at;
ALTER TABLE sync_runs RENAME COLUMN "finishedAt" TO finished_at;
ALTER TABLE sync_runs RENAME COLUMN "rowsUpserted" TO rows_upserted;
ALTER TABLE sync_runs RENAME COLUMN "watermarkBefore" TO watermark_before;
ALTER TABLE sync_runs RENAME COLUMN "watermarkAfter" TO watermark_after;

ALTER TABLE computed_columns RENAME COLUMN "datasetId" TO dataset_id;
ALTER TABLE computed_columns RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE computed_columns RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE parameters RENAME COLUMN "valueNumber" TO value_number;
ALTER TABLE parameters RENAME COLUMN "valueText" TO value_text;
ALTER TABLE parameters RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE user_module_accesses RENAME COLUMN "userId" TO user_id;
ALTER TABLE user_module_accesses RENAME COLUMN "moduleId" TO module_id;
ALTER TABLE user_module_accesses RENAME COLUMN "createdAt" TO created_at;

ALTER TABLE panels RENAME COLUMN "moduleId" TO module_id;

ALTER TABLE locations RENAME COLUMN "officialName" TO official_name;
ALTER TABLE locations RENAME COLUMN "matchColigada" TO match_coligada;
ALTER TABLE locations RENAME COLUMN "matchFilial" TO match_filial;
ALTER TABLE locations RENAME COLUMN "matchClientePattern" TO match_cliente_pattern;
ALTER TABLE locations RENAME COLUMN "motoristaNome" TO motorista_nome;
ALTER TABLE locations RENAME COLUMN "raioMetros" TO raio_metros;
ALTER TABLE locations RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE locations RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE location_visits RENAME COLUMN "locationId" TO location_id;
ALTER TABLE location_visits RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE location_visits RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE vehicle_positions RENAME COLUMN "capturedAt" TO captured_at;
ALTER TABLE vehicle_positions RENAME COLUMN "speedKmh" TO speed_kmh;
ALTER TABLE vehicle_positions RENAME COLUMN "createdAt" TO created_at;

ALTER TABLE speed_alerts RENAME COLUMN "speedKmh" TO speed_kmh;
ALTER TABLE speed_alerts RENAME COLUMN "limiteKmh" TO limite_kmh;
ALTER TABLE speed_alerts RENAME COLUMN "capturedAt" TO captured_at;
ALTER TABLE speed_alerts RENAME COLUMN "acknowledgedAt" TO acknowledged_at;
ALTER TABLE speed_alerts RENAME COLUMN "acknowledgedBy" TO acknowledged_by;
ALTER TABLE speed_alerts RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE speed_alerts RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE plate_compositions RENAME COLUMN "effectiveFrom" TO effective_from;
ALTER TABLE plate_compositions RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE plate_compositions RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE routes RENAME COLUMN "originId" TO origin_id;
ALTER TABLE routes RENAME COLUMN "destinationId" TO destination_id;
ALTER TABLE routes RENAME COLUMN "distanceAsphaltKm" TO distance_asphalt_km;
ALTER TABLE routes RENAME COLUMN "distanceDirtKm" TO distance_dirt_km;
ALTER TABLE routes RENAME COLUMN "speedLoadedKmh" TO speed_loaded_kmh;
ALTER TABLE routes RENAME COLUMN "speedEmptyKmh" TO speed_empty_kmh;
ALTER TABLE routes RENAME COLUMN "loadMinutes" TO load_minutes;
ALTER TABLE routes RENAME COLUMN "unloadMinutes" TO unload_minutes;
ALTER TABLE routes RENAME COLUMN "expectedRoundTripDays" TO expected_round_trip_days;
ALTER TABLE routes RENAME COLUMN "fixedComposition" TO fixed_composition;
ALTER TABLE routes RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE routes RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE route_freight_prices RENAME COLUMN "routeId" TO route_id;
ALTER TABLE route_freight_prices RENAME COLUMN "valorReferencia" TO valor_referencia;
ALTER TABLE route_freight_prices RENAME COLUMN "effectiveFrom" TO effective_from;
ALTER TABLE route_freight_prices RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE route_freight_prices RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE vehicle_maintenances RENAME COLUMN "startDate" TO start_date;
ALTER TABLE vehicle_maintenances RENAME COLUMN "endDate" TO end_date;
ALTER TABLE vehicle_maintenances RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE vehicle_maintenances RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE driver_vacations RENAME COLUMN "startDate" TO start_date;
ALTER TABLE driver_vacations RENAME COLUMN "endDate" TO end_date;
ALTER TABLE driver_vacations RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE driver_vacations RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE trip_justifications RENAME COLUMN "tripKey" TO trip_key;
ALTER TABLE trip_justifications RENAME COLUMN "novaPrevisao" TO nova_previsao;
ALTER TABLE trip_justifications RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE trip_justifications RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE trip_tickets RENAME COLUMN "pesoAproximadoTon" TO peso_aproximado_ton;
ALTER TABLE trip_tickets RENAME COLUMN "dataTicket" TO data_ticket;
ALTER TABLE trip_tickets RENAME COLUMN "fileName" TO file_name;
ALTER TABLE trip_tickets RENAME COLUMN "fileMime" TO file_mime;
ALTER TABLE trip_tickets RENAME COLUMN "fileData" TO file_data;
ALTER TABLE trip_tickets RENAME COLUMN "ocrStatus" TO ocr_status;
ALTER TABLE trip_tickets RENAME COLUMN "ocrTexto" TO ocr_texto;
ALTER TABLE trip_tickets RENAME COLUMN "ocrLog" TO ocr_log;
ALTER TABLE trip_tickets RENAME COLUMN "ocrProgress" TO ocr_progress;
ALTER TABLE trip_tickets RENAME COLUMN "matchedTripKeys" TO matched_trip_keys;
ALTER TABLE trip_tickets RENAME COLUMN "conferidoEm" TO conferido_em;
ALTER TABLE trip_tickets RENAME COLUMN "conferidoPor" TO conferido_por;
ALTER TABLE trip_tickets RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE trip_tickets RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE composition_specs RENAME COLUMN "numEixos" TO num_eixos;
ALTER TABLE composition_specs RENAME COLUMN "pbtcMaximoTon" TO pbtc_maximo_ton;
ALTER TABLE composition_specs RENAME COLUMN "taraMinTon" TO tara_min_ton;
ALTER TABLE composition_specs RENAME COLUMN "taraMaxTon" TO tara_max_ton;
ALTER TABLE composition_specs RENAME COLUMN "cargaLiquidaMinTon" TO carga_liquida_min_ton;
ALTER TABLE composition_specs RENAME COLUMN "cargaLiquidaMaxTon" TO carga_liquida_max_ton;
ALTER TABLE composition_specs RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE composition_specs RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE product_types RENAME COLUMN "codigoPrd" TO codigo_prd;
ALTER TABLE product_types RENAME COLUMN "produtoNome" TO produto_nome;
ALTER TABLE product_types RENAME COLUMN "tipoProduto" TO tipo_produto;
ALTER TABLE product_types RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE product_types RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE fase3_cliente_acoes RENAME COLUMN "atualizadoPor" TO atualizado_por;
ALTER TABLE fase3_cliente_acoes RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE fase3_cliente_acoes RENAME COLUMN "updatedAt" TO updated_at;

ALTER TABLE critica_modelo_achados RENAME COLUMN "reconhecidoPor" TO reconhecido_por;
ALTER TABLE critica_modelo_achados RENAME COLUMN "reconhecidoEm" TO reconhecido_em;
ALTER TABLE critica_modelo_achados RENAME COLUMN "createdAt" TO created_at;
ALTER TABLE critica_modelo_achados RENAME COLUMN "updatedAt" TO updated_at;

-- ============================================================
-- 3) Novas colunas de preparação multi-tenant (nullable, sem FK)
--    Só nas tabelas de dado operacional de negócio (não nas de
--    infra/sistema: users, audit_logs, data_sources, datasets,
--    dataset_rows, sync_schedules, sync_runs, computed_columns,
--    parameters, modules, user_module_accesses, panels).
-- ============================================================

ALTER TABLE locations ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE location_visits ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE vehicle_positions ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE speed_alerts ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE plate_compositions ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE routes ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE route_freight_prices ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE vehicle_maintenances ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE driver_vacations ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE trip_justifications ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE trip_tickets ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE composition_specs ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE product_types ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE fase3_cliente_acoes ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
ALTER TABLE critica_modelo_achados ADD COLUMN holding_id text, ADD COLUMN company_id text, ADD COLUMN branch_id text;
