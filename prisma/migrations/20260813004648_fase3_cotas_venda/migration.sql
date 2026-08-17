-- AlterTable
ALTER TABLE "audit_logs" RENAME CONSTRAINT "AuditLog_pkey" TO "audit_logs_pkey";

-- AlterTable
ALTER TABLE "composition_specs" RENAME CONSTRAINT "CompositionSpec_pkey" TO "composition_specs_pkey";

-- AlterTable
ALTER TABLE "computed_columns" RENAME CONSTRAINT "ComputedColumn_pkey" TO "computed_columns_pkey";

-- AlterTable
ALTER TABLE "critica_modelo_achados" RENAME CONSTRAINT "CriticaModeloAchado_pkey" TO "critica_modelo_achados_pkey";

-- AlterTable
ALTER TABLE "data_sources" RENAME CONSTRAINT "DataSource_pkey" TO "data_sources_pkey";

-- AlterTable
ALTER TABLE "dataset_rows" RENAME CONSTRAINT "DatasetRow_pkey" TO "dataset_rows_pkey";

-- AlterTable
ALTER TABLE "datasets" RENAME CONSTRAINT "Dataset_pkey" TO "datasets_pkey";

-- AlterTable
ALTER TABLE "driver_vacations" RENAME CONSTRAINT "DriverVacation_pkey" TO "driver_vacations_pkey";

-- AlterTable
ALTER TABLE "fase3_cliente_acoes" RENAME CONSTRAINT "Fase3ClienteAcao_pkey" TO "fase3_cliente_acoes_pkey";

-- AlterTable
ALTER TABLE "location_visits" RENAME CONSTRAINT "LocationVisit_pkey" TO "location_visits_pkey";

-- AlterTable
ALTER TABLE "locations" RENAME CONSTRAINT "Location_pkey" TO "locations_pkey";

-- AlterTable
ALTER TABLE "modules" RENAME CONSTRAINT "Module_pkey" TO "modules_pkey";

-- AlterTable
ALTER TABLE "panels" RENAME CONSTRAINT "Panel_pkey" TO "panels_pkey";

-- AlterTable
ALTER TABLE "parameters" RENAME CONSTRAINT "Parameter_pkey" TO "parameters_pkey";

-- AlterTable
ALTER TABLE "plate_compositions" RENAME CONSTRAINT "PlateComposition_pkey" TO "plate_compositions_pkey";

-- AlterTable
ALTER TABLE "product_types" RENAME CONSTRAINT "ProductType_pkey" TO "product_types_pkey";

-- AlterTable
ALTER TABLE "route_freight_prices" RENAME CONSTRAINT "RouteFreightPrice_pkey" TO "route_freight_prices_pkey";

-- AlterTable
ALTER TABLE "routes" RENAME CONSTRAINT "Route_pkey" TO "routes_pkey";

-- AlterTable
ALTER TABLE "speed_alerts" RENAME CONSTRAINT "SpeedAlert_pkey" TO "speed_alerts_pkey";

-- AlterTable
ALTER TABLE "sync_runs" RENAME CONSTRAINT "SyncRun_pkey" TO "sync_runs_pkey";

-- AlterTable
ALTER TABLE "sync_schedules" RENAME CONSTRAINT "SyncSchedule_pkey" TO "sync_schedules_pkey";

-- AlterTable
ALTER TABLE "trip_justifications" RENAME CONSTRAINT "TripJustification_pkey" TO "trip_justifications_pkey";

-- AlterTable
ALTER TABLE "trip_tickets" RENAME CONSTRAINT "TripTicket_pkey" TO "trip_tickets_pkey";

-- AlterTable
ALTER TABLE "user_module_accesses" RENAME CONSTRAINT "UserModuleAccess_pkey" TO "user_module_accesses_pkey";

-- AlterTable
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";

-- AlterTable
ALTER TABLE "vehicle_maintenances" RENAME CONSTRAINT "VehicleMaintenance_pkey" TO "vehicle_maintenances_pkey";

-- AlterTable
ALTER TABLE "vehicle_positions" RENAME CONSTRAINT "VehiclePosition_pkey" TO "vehicle_positions_pkey";

-- CreateTable
CREATE TABLE "monthly_quota_settings" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "meta_volume_m3" DECIMAL(65,30) NOT NULL,
    "icms_7_pct" DECIMAL(65,30) NOT NULL,
    "icms_12_pct" DECIMAL(65,30) NOT NULL,
    "icms_18_pct" DECIMAL(65,30) NOT NULL,
    "holding_id" TEXT,
    "company_id" TEXT,
    "branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_quota_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_quotas" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "cod_distribuidor" TEXT NOT NULL,
    "nome_distribuidor" TEXT,
    "meta_valor" DECIMAL(65,30) NOT NULL,
    "holding_id" TEXT,
    "company_id" TEXT,
    "branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributor_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_quotas" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "codigo_prd" TEXT NOT NULL,
    "nome_produto" TEXT,
    "m3_por_unidade" DECIMAL(65,30),
    "cota_unidades" DECIMAL(65,30) NOT NULL,
    "holding_id" TEXT,
    "company_id" TEXT,
    "branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_quota_settings_month_key" ON "monthly_quota_settings"("month");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_quotas_month_cod_distribuidor_key" ON "distributor_quotas"("month", "cod_distribuidor");

-- CreateIndex
CREATE UNIQUE INDEX "product_quotas_month_codigo_prd_key" ON "product_quotas"("month", "codigo_prd");

-- RenameForeignKey
ALTER TABLE "computed_columns" RENAME CONSTRAINT "ComputedColumn_datasetId_fkey" TO "computed_columns_dataset_id_fkey";

-- RenameForeignKey
ALTER TABLE "dataset_rows" RENAME CONSTRAINT "DatasetRow_datasetId_fkey" TO "dataset_rows_dataset_id_fkey";

-- RenameForeignKey
ALTER TABLE "datasets" RENAME CONSTRAINT "Dataset_dataSourceId_fkey" TO "datasets_data_source_id_fkey";

-- RenameForeignKey
ALTER TABLE "location_visits" RENAME CONSTRAINT "LocationVisit_locationId_fkey" TO "location_visits_location_id_fkey";

-- RenameForeignKey
ALTER TABLE "panels" RENAME CONSTRAINT "Panel_moduleId_fkey" TO "panels_module_id_fkey";

-- RenameForeignKey
ALTER TABLE "route_freight_prices" RENAME CONSTRAINT "RouteFreightPrice_routeId_fkey" TO "route_freight_prices_route_id_fkey";

-- RenameForeignKey
ALTER TABLE "routes" RENAME CONSTRAINT "Route_destinationId_fkey" TO "routes_destination_id_fkey";

-- RenameForeignKey
ALTER TABLE "routes" RENAME CONSTRAINT "Route_originId_fkey" TO "routes_origin_id_fkey";

-- RenameForeignKey
ALTER TABLE "sync_runs" RENAME CONSTRAINT "SyncRun_datasetId_fkey" TO "sync_runs_dataset_id_fkey";

-- RenameForeignKey
ALTER TABLE "sync_schedules" RENAME CONSTRAINT "SyncSchedule_datasetId_fkey" TO "sync_schedules_dataset_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_module_accesses" RENAME CONSTRAINT "UserModuleAccess_moduleId_fkey" TO "user_module_accesses_module_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_module_accesses" RENAME CONSTRAINT "UserModuleAccess_userId_fkey" TO "user_module_accesses_user_id_fkey";

-- RenameIndex
ALTER INDEX "AuditLog_createdAt_idx" RENAME TO "audit_logs_created_at_idx";

-- RenameIndex
ALTER INDEX "AuditLog_entity_entityId_idx" RENAME TO "audit_logs_entity_entity_id_idx";

-- RenameIndex
ALTER INDEX "CompositionSpec_composition_key" RENAME TO "composition_specs_composition_key";

-- RenameIndex
ALTER INDEX "ComputedColumn_datasetId_name_key" RENAME TO "computed_columns_dataset_id_name_key";

-- RenameIndex
ALTER INDEX "CriticaModeloAchado_modulo_chave_key" RENAME TO "critica_modelo_achados_modulo_chave_key";

-- RenameIndex
ALTER INDEX "DatasetRow_datasetId_pk_key" RENAME TO "dataset_rows_dataset_id_pk_key";

-- RenameIndex
ALTER INDEX "DatasetRow_datasetId_syncedAt_idx" RENAME TO "dataset_rows_dataset_id_synced_at_idx";

-- RenameIndex
ALTER INDEX "Dataset_code_key" RENAME TO "datasets_code_key";

-- RenameIndex
ALTER INDEX "DriverVacation_motorista_startDate_idx" RENAME TO "driver_vacations_motorista_start_date_idx";

-- RenameIndex
ALTER INDEX "Fase3ClienteAcao_cliente_key" RENAME TO "fase3_cliente_acoes_cliente_key";

-- RenameIndex
ALTER INDEX "LocationVisit_locationId_chegada_idx" RENAME TO "location_visits_location_id_chegada_idx";

-- RenameIndex
ALTER INDEX "LocationVisit_placa_saida_idx" RENAME TO "location_visits_placa_saida_idx";

-- RenameIndex
ALTER INDEX "Location_name_key" RENAME TO "locations_name_key";

-- RenameIndex
ALTER INDEX "Module_code_key" RENAME TO "modules_code_key";

-- RenameIndex
ALTER INDEX "Panel_code_key" RENAME TO "panels_code_key";

-- RenameIndex
ALTER INDEX "Parameter_code_key" RENAME TO "parameters_code_key";

-- RenameIndex
ALTER INDEX "PlateComposition_placa_effectiveFrom_idx" RENAME TO "plate_compositions_placa_effective_from_idx";

-- RenameIndex
ALTER INDEX "ProductType_codigoPrd_key" RENAME TO "product_types_codigo_prd_key";

-- RenameIndex
ALTER INDEX "RouteFreightPrice_routeId_effectiveFrom_idx" RENAME TO "route_freight_prices_route_id_effective_from_idx";

-- RenameIndex
ALTER INDEX "Route_originId_destinationId_key" RENAME TO "routes_origin_id_destination_id_key";

-- RenameIndex
ALTER INDEX "SpeedAlert_placa_acknowledgedAt_idx" RENAME TO "speed_alerts_placa_acknowledged_at_idx";

-- RenameIndex
ALTER INDEX "SyncRun_datasetId_startedAt_idx" RENAME TO "sync_runs_dataset_id_started_at_idx";

-- RenameIndex
ALTER INDEX "SyncSchedule_datasetId_key" RENAME TO "sync_schedules_dataset_id_key";

-- RenameIndex
ALTER INDEX "TripJustification_tripKey_key" RENAME TO "trip_justifications_trip_key_key";

-- RenameIndex
ALTER INDEX "TripTicket_placa_dataTicket_idx" RENAME TO "trip_tickets_placa_data_ticket_idx";

-- RenameIndex
ALTER INDEX "UserModuleAccess_moduleId_idx" RENAME TO "user_module_accesses_module_id_idx";

-- RenameIndex
ALTER INDEX "User_email_key" RENAME TO "users_email_key";

-- RenameIndex
ALTER INDEX "VehicleMaintenance_placa_startDate_idx" RENAME TO "vehicle_maintenances_placa_start_date_idx";

-- RenameIndex
ALTER INDEX "VehiclePosition_placa_capturedAt_key" RENAME TO "vehicle_positions_placa_captured_at_key";
