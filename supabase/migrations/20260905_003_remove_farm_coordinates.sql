-- migrate:up
-- Địa chỉ văn bản là đủ cho cơ sở nuôi, không lưu tọa độ địa lý.

BEGIN;

ALTER TABLE public.farms
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude;

COMMIT;

-- migrate:down
BEGIN;

ALTER TABLE public.farms
  ADD COLUMN latitude NUMERIC(10, 7),
  ADD COLUMN longitude NUMERIC(10, 7),
  ADD CONSTRAINT farms_latitude_valid
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT farms_longitude_valid
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

COMMIT;
