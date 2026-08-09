-- migrate:up
-- Initial schema for the seafood provenance MVP.

-- ============================================================
-- UP
-- Shrimp / Crab Traceability Management System
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENUMS
-- ============================================================

CREATE TYPE public.user_role AS ENUM (
  'ADMIN',
  'FARMER',
  'TRANSPORTER',
  'DISTRIBUTOR'
);

CREATE TYPE public.organization_type AS ENUM (
  'FARMER_HOUSEHOLD',
  'COOPERATIVE',
  'COMPANY',
  'PROCESSOR',
  'DISTRIBUTOR',
  'RETAILER',
  'EXPORTER'
);

CREATE TYPE public.pond_status AS ENUM (
  'ACTIVE',
  'INACTIVE',
  'MAINTENANCE'
);

CREATE TYPE public.species_type AS ENUM (
  'SHRIMP',
  'CRAB'
);

CREATE TYPE public.batch_status AS ENUM (
  'PREPARING',
  'GROWING',
  'READY_FOR_HARVEST',
  'HARVESTED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE public.qr_status AS ENUM (
  'ACTIVE',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE public.farming_log_type AS ENUM (
  'FEEDING',
  'MEDICINE',
  'WATER_QUALITY',
  'CARE',
  'ENVIRONMENT',
  'MORTALITY',
  'OTHER'
);

CREATE TYPE public.transport_status AS ENUM (
  'PLANNING',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED'
);

CREATE TYPE public.distribution_status AS ENUM (
  'PLANNING',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'CANCELLED'
);

CREATE TYPE public.blockchain_event_type AS ENUM (
  'BATCH_CREATED',
  'FARMING_LOG_RECORDED',
  'HARVEST_RECORDED',
  'TRANSPORT_RECORDED',
  'DISTRIBUTION_RECORDED',
  'QUALITY_INSPECTION_RECORDED',
  'OTHER'
);

CREATE TYPE public.blockchain_status AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED'
);

CREATE TYPE public.audit_action AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'CONFIRM'
);

CREATE TYPE public.alert_type AS ENUM (
  'MISSING_LOG',
  'INVALID_DATA',
  'EXPIRED_QR',
  'TEMPERATURE_OUT_OF_RANGE',
  'OTHER'
);

CREATE TYPE public.alert_severity AS ENUM (
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL'
);

CREATE TYPE public.alert_status AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED'
);


-- ============================================================
-- 2. ORGANIZATIONS
-- Hộ nuôi / HTX / doanh nghiệp / đơn vị phân phối...
-- ============================================================

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name VARCHAR(255) NOT NULL,

  type public.organization_type NOT NULL,

  address TEXT,

  phone VARCHAR(20),

  email VARCHAR(255),

  tax_code VARCHAR(50),

  representative VARCHAR(255),

  certification VARCHAR(255),

  status BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 3. USER PROFILES
-- Authentication nằm trong auth.users
-- ============================================================

CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  organization_id UUID
    REFERENCES public.organizations(id)
    ON DELETE SET NULL,

  full_name VARCHAR(255) NOT NULL,

  email VARCHAR(255),

  phone VARCHAR(20),

  role public.user_role NOT NULL DEFAULT 'FARMER',

  wallet_address VARCHAR(255),

  status BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 4. FARMS
-- ============================================================

CREATE TABLE public.farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,

  farm_name VARCHAR(255) NOT NULL,

  address TEXT,

  area NUMERIC(14, 2),

  certification VARCHAR(255),

  latitude NUMERIC(10, 7),

  longitude NUMERIC(10, 7),

  status BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT farms_area_positive
    CHECK (area IS NULL OR area > 0),

  CONSTRAINT farms_latitude_valid
    CHECK (
      latitude IS NULL
      OR latitude BETWEEN -90 AND 90
    ),

  CONSTRAINT farms_longitude_valid
    CHECK (
      longitude IS NULL
      OR longitude BETWEEN -180 AND 180
    )
);


-- ============================================================
-- 5. PONDS
-- ============================================================

CREATE TABLE public.ponds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  farm_id UUID NOT NULL
    REFERENCES public.farms(id)
    ON DELETE RESTRICT,

  pond_code VARCHAR(100) NOT NULL,

  pond_name VARCHAR(255) NOT NULL,

  area NUMERIC(14, 2),

  depth NUMERIC(8, 2),

  water_type VARCHAR(100),

  status public.pond_status NOT NULL DEFAULT 'ACTIVE',

  latitude NUMERIC(10, 7),

  longitude NUMERIC(10, 7),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ponds_farm_code_unique
    UNIQUE (farm_id, pond_code),

  CONSTRAINT ponds_area_positive
    CHECK (area IS NULL OR area > 0),

  CONSTRAINT ponds_depth_positive
    CHECK (depth IS NULL OR depth > 0),

  CONSTRAINT ponds_latitude_valid
    CHECK (
      latitude IS NULL
      OR latitude BETWEEN -90 AND 90
    ),

  CONSTRAINT ponds_longitude_valid
    CHECK (
      longitude IS NULL
      OR longitude BETWEEN -180 AND 180
    )
);


-- ============================================================
-- 6. BATCHES
-- Lô nuôi - bảng trung tâm của hệ thống
-- ============================================================

CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_code VARCHAR(100) NOT NULL UNIQUE,

  pond_id UUID NOT NULL
    REFERENCES public.ponds(id)
    ON DELETE RESTRICT,

  species public.species_type NOT NULL,

  seed_source VARCHAR(255),

  seed_quantity INTEGER NOT NULL,

  stocking_date TIMESTAMPTZ NOT NULL,

  expected_harvest_date TIMESTAMPTZ,

  actual_harvest_date TIMESTAMPTZ,

  yield_quantity NUMERIC(14, 2),

  status public.batch_status NOT NULL DEFAULT 'PREPARING',

  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT batches_seed_quantity_positive
    CHECK (seed_quantity > 0),

  CONSTRAINT batches_yield_quantity_non_negative
    CHECK (
      yield_quantity IS NULL
      OR yield_quantity >= 0
    ),

  CONSTRAINT batches_expected_harvest_date_valid
    CHECK (
      expected_harvest_date IS NULL
      OR expected_harvest_date >= stocking_date
    ),

  CONSTRAINT batches_actual_harvest_date_valid
    CHECK (
      actual_harvest_date IS NULL
      OR actual_harvest_date >= stocking_date
    )
);


-- ============================================================
-- 7. FARMING LOGS
-- Nhật ký nuôi
-- ============================================================

CREATE TABLE public.farming_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE CASCADE,

  created_by UUID NOT NULL
    REFERENCES public.user_profiles(id)
    ON DELETE RESTRICT,

  log_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  log_type public.farming_log_type NOT NULL,

  details JSONB NOT NULL DEFAULT '{}'::JSONB,

  image_url TEXT,

  data_hash VARCHAR(255),

  tx_hash VARCHAR(255),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 8. HARVESTS
-- Cho phép một batch thu hoạch nhiều đợt
-- ============================================================

CREATE TABLE public.harvests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE RESTRICT,

  harvest_date TIMESTAMPTZ NOT NULL,

  quantity NUMERIC(14, 2) NOT NULL,

  average_weight NUMERIC(12, 3),

  quality_grade VARCHAR(100),

  note TEXT,

  data_hash VARCHAR(255),

  tx_hash VARCHAR(255),

  created_by UUID NOT NULL
    REFERENCES public.user_profiles(id)
    ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT harvests_quantity_positive
    CHECK (quantity > 0),

  CONSTRAINT harvests_average_weight_positive
    CHECK (
      average_weight IS NULL
      OR average_weight > 0
    )
);


-- ============================================================
-- 9. TRANSPORT LOGS
-- ============================================================

CREATE TABLE public.transport_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE RESTRICT,

  handler_id UUID
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL,

  transport_code VARCHAR(100) NOT NULL UNIQUE,

  transport_date TIMESTAMPTZ NOT NULL,

  vehicle VARCHAR(255),

  driver VARCHAR(255),

  from_location TEXT NOT NULL,

  to_location TEXT NOT NULL,

  temperature NUMERIC(6, 2),

  status public.transport_status NOT NULL DEFAULT 'PLANNING',

  note TEXT,

  data_hash VARCHAR(255),

  tx_hash VARCHAR(255),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 10. DISTRIBUTION LOGS
-- ============================================================

CREATE TABLE public.distribution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE RESTRICT,

  distributor_id UUID
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL,

  receiver_organization_id UUID
    REFERENCES public.organizations(id)
    ON DELETE SET NULL,

  distribution_date TIMESTAMPTZ NOT NULL,

  quantity NUMERIC(14, 2) NOT NULL,

  location TEXT,

  status public.distribution_status
    NOT NULL
    DEFAULT 'PLANNING',

  note TEXT,

  data_hash VARCHAR(255),

  tx_hash VARCHAR(255),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT distribution_quantity_positive
    CHECK (quantity > 0)
);


-- ============================================================
-- 11. QR CODES
-- Mỗi batch có một QR hiện tại
-- ============================================================

CREATE TABLE public.qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL UNIQUE
    REFERENCES public.batches(id)
    ON DELETE CASCADE,

  qr_code VARCHAR(255) NOT NULL UNIQUE,

  trace_code VARCHAR(255) NOT NULL UNIQUE,

  trace_url TEXT NOT NULL,

  status public.qr_status NOT NULL DEFAULT 'ACTIVE',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  expired_at TIMESTAMPTZ
);


-- ============================================================
-- 12. BLOCKCHAIN RECORDS
-- Lưu dấu vết transaction Blockchain
-- ============================================================

CREATE TABLE public.blockchain_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE RESTRICT,

  -- Ví dụ:
  -- BATCH
  -- FARMING_LOG
  -- HARVEST
  -- TRANSPORT_LOG
  -- DISTRIBUTION_LOG
  entity_type VARCHAR(100) NOT NULL,

  entity_id UUID NOT NULL,

  event_type public.blockchain_event_type NOT NULL,

  data_hash VARCHAR(255) NOT NULL,

  transaction_hash VARCHAR(255),

  block_number BIGINT,

  contract_address VARCHAR(255),

  status public.blockchain_status NOT NULL DEFAULT 'PENDING',

  recorded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT blockchain_block_number_non_negative
    CHECK (
      block_number IS NULL
      OR block_number >= 0
    )
);


-- Transaction hash chỉ unique khi đã có giá trị
CREATE UNIQUE INDEX idx_blockchain_transaction_hash
  ON public.blockchain_records(transaction_hash)
  WHERE transaction_hash IS NOT NULL;


-- ============================================================
-- 13. AUDIT LOGS
-- Lịch sử thay đổi dữ liệu
-- ============================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL,

  entity_type VARCHAR(100) NOT NULL,

  entity_id UUID NOT NULL,

  action public.audit_action NOT NULL,

  old_data JSONB,

  new_data JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 14. ALERTS
-- Cảnh báo dữ liệu thiếu / sai / bất thường
-- ============================================================

CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  batch_id UUID NOT NULL
    REFERENCES public.batches(id)
    ON DELETE CASCADE,

  type public.alert_type NOT NULL,

  message TEXT NOT NULL,

  severity public.alert_severity NOT NULL DEFAULT 'WARNING',

  status public.alert_status NOT NULL DEFAULT 'OPEN',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  resolved_at TIMESTAMPTZ,

  resolved_by UUID
    REFERENCES public.user_profiles(id)
    ON DELETE SET NULL,

  CONSTRAINT alerts_resolved_time_valid
    CHECK (
      resolved_at IS NULL
      OR resolved_at >= created_at
    )
);


-- ============================================================
-- 15. INDEXES
-- ============================================================

-- User / Organization
CREATE INDEX idx_user_profiles_organization_id
  ON public.user_profiles(organization_id);

CREATE INDEX idx_user_profiles_role
  ON public.user_profiles(role);

CREATE INDEX idx_organizations_type
  ON public.organizations(type);


-- Farm / Pond
CREATE INDEX idx_farms_organization_id
  ON public.farms(organization_id);

CREATE INDEX idx_ponds_farm_id
  ON public.ponds(farm_id);

CREATE INDEX idx_ponds_status
  ON public.ponds(status);


-- Batch
CREATE INDEX idx_batches_pond_id
  ON public.batches(pond_id);

CREATE INDEX idx_batches_species
  ON public.batches(species);

CREATE INDEX idx_batches_status
  ON public.batches(status);

CREATE INDEX idx_batches_stocking_date
  ON public.batches(stocking_date);

CREATE INDEX idx_batches_expected_harvest_date
  ON public.batches(expected_harvest_date);


-- Farming logs
CREATE INDEX idx_farming_logs_batch_id
  ON public.farming_logs(batch_id);

CREATE INDEX idx_farming_logs_created_by
  ON public.farming_logs(created_by);

CREATE INDEX idx_farming_logs_log_date
  ON public.farming_logs(log_date);

CREATE INDEX idx_farming_logs_log_type
  ON public.farming_logs(log_type);


-- Harvest
CREATE INDEX idx_harvests_batch_id
  ON public.harvests(batch_id);

CREATE INDEX idx_harvests_harvest_date
  ON public.harvests(harvest_date);


-- Transport
CREATE INDEX idx_transport_logs_batch_id
  ON public.transport_logs(batch_id);

CREATE INDEX idx_transport_logs_handler_id
  ON public.transport_logs(handler_id);

CREATE INDEX idx_transport_logs_transport_date
  ON public.transport_logs(transport_date);

CREATE INDEX idx_transport_logs_status
  ON public.transport_logs(status);


-- Distribution
CREATE INDEX idx_distribution_logs_batch_id
  ON public.distribution_logs(batch_id);

CREATE INDEX idx_distribution_logs_distributor_id
  ON public.distribution_logs(distributor_id);

CREATE INDEX idx_distribution_logs_receiver_organization_id
  ON public.distribution_logs(receiver_organization_id);

CREATE INDEX idx_distribution_logs_distribution_date
  ON public.distribution_logs(distribution_date);


-- Blockchain
CREATE INDEX idx_blockchain_records_batch_id
  ON public.blockchain_records(batch_id);

CREATE INDEX idx_blockchain_records_entity
  ON public.blockchain_records(entity_type, entity_id);

CREATE INDEX idx_blockchain_records_status
  ON public.blockchain_records(status);


-- Audit
CREATE INDEX idx_audit_logs_user_id
  ON public.audit_logs(user_id);

CREATE INDEX idx_audit_logs_entity
  ON public.audit_logs(entity_type, entity_id);

CREATE INDEX idx_audit_logs_created_at
  ON public.audit_logs(created_at);


-- Alert
CREATE INDEX idx_alerts_batch_id
  ON public.alerts(batch_id);

CREATE INDEX idx_alerts_status
  ON public.alerts(status);

CREATE INDEX idx_alerts_type
  ON public.alerts(type);


-- ============================================================
-- 16. UPDATED_AT FUNCTION
-- ============================================================

CREATE FUNCTION public.set_traceability_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ============================================================
-- 17. UPDATED_AT TRIGGERS
-- ============================================================

CREATE TRIGGER trg_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_farms_updated_at
BEFORE UPDATE ON public.farms
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_ponds_updated_at
BEFORE UPDATE ON public.ponds
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_batches_updated_at
BEFORE UPDATE ON public.batches
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_farming_logs_updated_at
BEFORE UPDATE ON public.farming_logs
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_harvests_updated_at
BEFORE UPDATE ON public.harvests
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_transport_logs_updated_at
BEFORE UPDATE ON public.transport_logs
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


CREATE TRIGGER trg_distribution_logs_updated_at
BEFORE UPDATE ON public.distribution_logs
FOR EACH ROW
EXECUTE FUNCTION public.set_traceability_updated_at();


COMMIT;

-- migrate:down
-- Roll back the complete initial traceability schema.

BEGIN;

DROP TABLE IF EXISTS public.alerts CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.blockchain_records CASCADE;
DROP TABLE IF EXISTS public.qr_codes CASCADE;
DROP TABLE IF EXISTS public.distribution_logs CASCADE;
DROP TABLE IF EXISTS public.transport_logs CASCADE;
DROP TABLE IF EXISTS public.harvests CASCADE;
DROP TABLE IF EXISTS public.farming_logs CASCADE;
DROP TABLE IF EXISTS public.batches CASCADE;
DROP TABLE IF EXISTS public.ponds CASCADE;
DROP TABLE IF EXISTS public.farms CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;

DROP FUNCTION IF EXISTS public.set_traceability_updated_at() CASCADE;

DROP TYPE IF EXISTS public.alert_status;
DROP TYPE IF EXISTS public.alert_severity;
DROP TYPE IF EXISTS public.alert_type;
DROP TYPE IF EXISTS public.audit_action;
DROP TYPE IF EXISTS public.blockchain_status;
DROP TYPE IF EXISTS public.blockchain_event_type;
DROP TYPE IF EXISTS public.distribution_status;
DROP TYPE IF EXISTS public.transport_status;
DROP TYPE IF EXISTS public.farming_log_type;
DROP TYPE IF EXISTS public.qr_status;
DROP TYPE IF EXISTS public.batch_status;
DROP TYPE IF EXISTS public.species_type;
DROP TYPE IF EXISTS public.pond_status;
DROP TYPE IF EXISTS public.organization_type;
DROP TYPE IF EXISTS public.user_role;

COMMIT;
