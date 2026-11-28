BEGIN;

ALTER TABLE public.organization_invitations
  DROP CONSTRAINT organization_invitations_kind_check,
  DROP CONSTRAINT organization_invitations_check1,
  ADD COLUMN requested_share_logs boolean NOT NULL DEFAULT false,
  ADD COLUMN requested_shared_batch_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT organization_invitations_kind_check CHECK (kind IN ('HOUSEHOLD','STAFF','HOUSEHOLD_REQUEST')),
  ADD CONSTRAINT organization_invitations_parties_check CHECK (
    (kind IN ('HOUSEHOLD','HOUSEHOLD_REQUEST') AND target_organization_id IS NOT NULL
      AND organization_id <> target_organization_id AND target_user_id IS NULL AND intended_role IS NULL)
    OR (kind='STAFF' AND target_user_id IS NOT NULL AND target_organization_id IS NULL
      AND intended_role IS NOT DISTINCT FROM 'STAFF')
  ),
  ADD CONSTRAINT organization_invitations_requested_sharing_check CHECK (
    cardinality(requested_shared_batch_ids) <= 200 AND array_position(requested_shared_batch_ids,NULL) IS NULL
    AND (kind='HOUSEHOLD_REQUEST' OR (NOT requested_share_logs AND cardinality(requested_shared_batch_ids)=0))
  );

CREATE UNIQUE INDEX pending_household_request_key
  ON public.organization_invitations(organization_id,target_organization_id)
  WHERE kind='HOUSEHOLD_REQUEST' AND status='PENDING';

COMMIT;
