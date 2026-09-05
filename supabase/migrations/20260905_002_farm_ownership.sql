-- migrate:up
-- Mỗi cơ sở nuôi có một chủ sở hữu; việc thuộc tổ chức là tùy chọn.

BEGIN;

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Hỗ trợ dữ liệu cũ bằng cách gán một thành viên của tổ chức làm chủ sở hữu.
-- Nếu còn cơ sở không xác định được chủ, lệnh SET NOT NULL sẽ dừng migration
-- để quản trị viên xử lý dữ liệu thay vì âm thầm gán sai.
UPDATE public.farms AS farm
SET owner_id = (
  SELECT profile.id
  FROM public.user_profiles AS profile
  WHERE profile.organization_id = farm.organization_id
  ORDER BY profile.created_at ASC
  LIMIT 1
)
WHERE farm.owner_id IS NULL;

ALTER TABLE public.farms
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE public.farms
  DROP CONSTRAINT IF EXISTS farms_owner_id_fkey,
  DROP CONSTRAINT IF EXISTS farms_organization_id_fkey;

ALTER TABLE public.farms
  ADD CONSTRAINT farms_owner_id_fkey
    FOREIGN KEY (owner_id)
    REFERENCES public.user_profiles(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT farms_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_farms_owner_id
  ON public.farms(owner_id);

COMMIT;

-- migrate:down
BEGIN;

DROP INDEX IF EXISTS public.idx_farms_owner_id;

ALTER TABLE public.farms
  DROP CONSTRAINT IF EXISTS farms_owner_id_fkey;

ALTER TABLE public.farms
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.farms
  DROP CONSTRAINT IF EXISTS farms_organization_id_fkey,
  ADD CONSTRAINT farms_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE RESTRICT,
  DROP COLUMN IF EXISTS owner_id;

COMMIT;
