-- Apply after 202611090001. Business confirmation and chain confirmation are separate.
BEGIN;

CREATE TABLE public.blockchain_outbox (
  event_id TEXT PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  event_type public.blockchain_event_type NOT NULL,
  payload JSONB NOT NULL,
  status public.blockchain_status NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.blockchain_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blockchain_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.blockchain_outbox TO service_role;
CREATE INDEX blockchain_outbox_due ON public.blockchain_outbox(retry_after) WHERE status <> 'SUCCESS';

-- A database lease serializes the shared signing wallet across processes and both workers.
CREATE TABLE public.blockchain_signer_leases (
  signer_key TEXT PRIMARY KEY, token UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.blockchain_signer_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blockchain_signer_leases FROM PUBLIC, anon, authenticated;
ALTER TABLE public.blockchain_records ADD COLUMN chain_id TEXT;
ALTER TABLE public.blockchain_records ADD COLUMN signed_transaction TEXT;
ALTER TABLE public.blockchain_records ADD COLUMN signer_address TEXT;
CREATE INDEX blockchain_records_signer_pending ON public.blockchain_records(chain_id, signer_address)
  WHERE status <> 'SUCCESS' AND signed_transaction IS NOT NULL;
-- Fail visibly if historical duplicates need reconciliation; never delete evidence automatically.
CREATE UNIQUE INDEX blockchain_records_unique_event ON public.blockchain_records(event_id);

CREATE FUNCTION public.claim_blockchain_signer(p_key TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed UUID;
BEGIN
  INSERT INTO public.blockchain_signer_leases(signer_key, token, expires_at)
  VALUES (p_key, gen_random_uuid(), NOW() + INTERVAL '5 minutes')
  ON CONFLICT (signer_key) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
    WHERE blockchain_signer_leases.expires_at < NOW()
  RETURNING token INTO claimed;
  RETURN claimed;
END;
$$;
CREATE FUNCTION public.release_blockchain_signer(p_key TEXT, p_token UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.blockchain_signer_leases WHERE signer_key = p_key AND token = p_token;
$$;

CREATE FUNCTION public.guard_blockchain_outbox() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ROW(NEW.event_id, NEW.batch_id, NEW.entity_type, NEW.entity_id, NEW.event_type, NEW.payload)
    IS DISTINCT FROM ROW(OLD.event_id, OLD.batch_id, OLD.entity_type, OLD.entity_id, OLD.event_type, OLD.payload) THEN
    RAISE EXCEPTION 'Outbox payload is immutable' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_blockchain_outbox BEFORE UPDATE ON public.blockchain_outbox
FOR EACH ROW EXECUTE FUNCTION public.guard_blockchain_outbox();

CREATE FUNCTION public.queue_harvest_proof() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
  VALUES (NEW.blockchain_event_id, NEW.batch_id, 'HARVEST', NEW.harvest_id, 'HARVEST_RECORDED', NEW.provenance);
  RETURN NEW;
END;
$$;
CREATE TRIGGER queue_harvest_proof AFTER INSERT ON public.harvest_lots
FOR EACH ROW EXECUTE FUNCTION public.queue_harvest_proof();

CREATE FUNCTION public.queue_batch_proof() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE body JSONB; farm UUID;
BEGIN
  -- Harvest versions share the harvest event; they must not enqueue a different payload.
  IF NEW.blockchain_event_id LIKE 'BATCH_CREATED:%' THEN
    SELECT farm_id INTO farm FROM public.ponds WHERE id = (NEW.snapshot->>'pond_id')::UUID;
    body := jsonb_build_object('batchId', NEW.batch_id, 'farmId', farm,
      'pondId', NEW.snapshot->'pond_id', 'batchCode', NEW.snapshot->'batch_code',
      'species', NEW.snapshot->'species', 'seedSource', NEW.snapshot->'seed_source',
      'seedQuantity', NEW.snapshot->'seed_quantity',
      'stockingDate', to_char((NEW.snapshot->>'stocking_date')::TIMESTAMPTZ AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expectedHarvestDate', to_char((NEW.snapshot->>'expected_harvest_date')::TIMESTAMPTZ AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status', NEW.snapshot->'status', 'note', NEW.snapshot->'note');
  ELSIF NEW.blockchain_event_id LIKE 'BATCH_CORRECTED:%' THEN
    body := jsonb_build_object('batch', NEW.snapshot, 'correctionReason', NEW.correction_reason, 'correctedBy', NEW.corrected_by);
  ELSE RETURN NEW;
  END IF;
  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
  VALUES (NEW.blockchain_event_id, NEW.batch_id, 'BATCH', NEW.batch_id,
    CASE WHEN NEW.version_number = 1 THEN 'BATCH_CREATED' ELSE 'BATCH_CORRECTED' END::public.blockchain_event_type, body);
  RETURN NEW;
END;
$$;
CREATE TRIGGER queue_batch_proof AFTER INSERT ON public.batch_versions
FOR EACH ROW EXECUTE FUNCTION public.queue_batch_proof();

-- Recover existing harvest snapshots, including a crash before blockchain_records was inserted.
-- Do not invent original batch payloads or resurrect draft farming logs from historical rows.
INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
SELECT l.blockchain_event_id, l.batch_id, 'HARVEST', l.harvest_id, 'HARVEST_RECORDED', l.provenance
FROM public.harvest_lots l WHERE NOT EXISTS (
  SELECT 1 FROM public.blockchain_records r WHERE r.event_id = l.blockchain_event_id AND r.status = 'SUCCESS'
);

CREATE FUNCTION public.claim_blockchain_outbox(p_event TEXT DEFAULT NULL)
RETURNS SETOF public.blockchain_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY WITH candidate AS (
    SELECT event_id FROM public.blockchain_outbox
    WHERE status <> 'SUCCESS' AND retry_after <= NOW()
      AND (p_event IS NULL OR event_id = p_event)
      AND (lease_until IS NULL OR lease_until < NOW())
    ORDER BY created_at, event_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE public.blockchain_outbox o SET lease_token = gen_random_uuid(), lease_until = NOW() + INTERVAL '5 minutes'
    FROM candidate c WHERE o.event_id = c.event_id RETURNING o.*;
END;
$$;

CREATE FUNCTION public.finish_blockchain_outbox(p_event TEXT, p_token UUID, p_status public.blockchain_status, p_error TEXT, p_delay INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE job public.blockchain_outbox; proof public.blockchain_records;
BEGIN
  SELECT * INTO job FROM public.blockchain_outbox WHERE event_id = p_event AND lease_token = p_token
    AND lease_until > NOW() FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF p_status = 'SUCCESS' THEN
    SELECT * INTO proof FROM public.blockchain_records WHERE event_id = p_event AND status = 'SUCCESS';
    IF NOT FOUND THEN RAISE EXCEPTION 'Proof not confirmed'; END IF;
    IF job.entity_type = 'FARMING_LOG' AND p_event NOT LIKE '%:revoke:%' THEN
      UPDATE public.farming_log_versions SET data_hash = proof.data_hash, tx_hash = proof.transaction_hash,
        block_number = proof.block_number WHERE blockchain_event_id = p_event;
      UPDATE public.farming_logs l SET data_hash = proof.data_hash, tx_hash = proof.transaction_hash
        FROM public.farming_log_versions v WHERE v.blockchain_event_id = p_event AND l.current_version_id = v.id;
    END IF;
  END IF;
  UPDATE public.blockchain_outbox SET status = p_status, attempt_count = attempt_count + 1,
    last_error = LEFT(p_error, 2000), retry_after = NOW() + make_interval(secs => LEAST(GREATEST(p_delay, 15), 3600)),
    lease_token = NULL, lease_until = NULL WHERE event_id = p_event;
  RETURN TRUE;
END;
$$;

-- Commit the lifecycle change, immutable candidate, audit and work item atomically.
CREATE FUNCTION public.commit_farming_log(
  p_id UUID, p_actor UUID, p_action TEXT, p_expected_version INTEGER, p_expected_updated TIMESTAMPTZ,
  p_changes JSONB, p_reason TEXT, p_payload JSONB, p_hash TEXT, p_evidence TEXT DEFAULT NULL
) RETURNS public.farming_logs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_log public.farming_logs; result public.farming_logs; version_id UUID := gen_random_uuid();
  candidate public.farming_logs; event TEXT; next_version INTEGER;
BEGIN
  SELECT l.* INTO old_log FROM public.farming_logs l JOIN public.batches b ON b.id = l.batch_id
    JOIN public.ponds p ON p.id = b.pond_id JOIN public.farms f ON f.id = p.farm_id
    JOIN public.user_profiles u ON u.id = p_actor AND u.status
    WHERE l.id = p_id AND (f.owner_id = p_actor OR u.role = 'ADMIN') FOR UPDATE OF l;
  IF NOT FOUND THEN RAISE EXCEPTION 'Log not accessible' USING ERRCODE = 'P0002'; END IF;
  IF old_log.current_version IS DISTINCT FROM p_expected_version OR old_log.updated_at IS DISTINCT FROM p_expected_updated THEN
    RAISE EXCEPTION 'Log changed' USING ERRCODE = 'PT409';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('CONFIRM', 'CORRECT', 'REVOKE') OR
    (p_action = 'CONFIRM' AND old_log.lifecycle_status <> 'DRAFT') OR
    (p_action <> 'CONFIRM' AND old_log.lifecycle_status <> 'CONFIRMED') THEN
    RAISE EXCEPTION 'Invalid lifecycle transition' USING ERRCODE = 'PT409';
  END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_payload IS NULL THEN
    RAISE EXCEPTION 'Invalid proof payload' USING ERRCODE = '22023';
  END IF;
  IF p_action <> 'CONFIRM' AND LENGTH(BTRIM(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid reason' USING ERRCODE = '22023';
  END IF;
  next_version := old_log.current_version + CASE WHEN p_action = 'CORRECT' THEN 1 ELSE 0 END;
  event := 'FARMING_LOG_RECORDED:' || p_id::TEXT || CASE
    WHEN p_action = 'REVOKE' THEN ':revoke:v' || next_version::TEXT
    WHEN next_version > 1 THEN ':v' || next_version::TEXT ELSE '' END;
  IF p_action = 'REVOKE' THEN
    UPDATE public.farming_log_versions SET status = 'REVOKED', revoked_by = p_actor,
      revoked_at = NOW(), revocation_reason = BTRIM(p_reason) WHERE id = old_log.current_version_id;
    UPDATE public.farming_logs SET lifecycle_status = 'REVOKED' WHERE id = p_id RETURNING * INTO result;
  ELSE
    candidate := jsonb_populate_record(old_log, COALESCE(p_changes, '{}'::JSONB));
    INSERT INTO public.farming_log_versions(id, farming_log_id, version_number, log_date, log_type, details,
      image_url, data_hash, blockchain_event_id, correction_reason, corrected_by, status, confirmed_at, supersedes_version_id, evidence_url)
    VALUES (version_id, p_id, next_version, candidate.log_date, candidate.log_type, candidate.details,
      candidate.image_url, p_hash, event, CASE WHEN p_action = 'CORRECT' THEN BTRIM(p_reason) END, p_actor,
      'ACTIVE', NOW(), old_log.current_version_id, p_evidence);
    IF old_log.current_version_id IS NOT NULL THEN
      UPDATE public.farming_log_versions SET status = 'SUPERSEDED' WHERE id = old_log.current_version_id;
    END IF;
    UPDATE public.farming_logs SET log_date = candidate.log_date, log_type = candidate.log_type,
      details = candidate.details, image_url = candidate.image_url, data_hash = p_hash, tx_hash = NULL,
      current_version = next_version, current_version_id = version_id, lifecycle_status = 'CONFIRMED'
      WHERE id = p_id RETURNING * INTO result;
  END IF;
  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
    VALUES (event, old_log.batch_id, 'FARMING_LOG', p_id, 'FARMING_LOG_RECORDED', p_payload);
  INSERT INTO public.audit_logs(user_id, entity_type, entity_id, action, old_data, new_data)
    VALUES (p_actor, 'FARMING_LOG', p_id,
      CASE WHEN p_action = 'CORRECT' THEN 'UPDATE' ELSE p_action END::public.audit_action, to_jsonb(old_log), to_jsonb(result));
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_blockchain_signer(TEXT), public.release_blockchain_signer(TEXT, UUID),
  public.claim_blockchain_outbox(TEXT), public.finish_blockchain_outbox(TEXT, UUID, public.blockchain_status, TEXT, INTEGER),
  public.commit_farming_log(UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_blockchain_signer(TEXT), public.release_blockchain_signer(TEXT, UUID),
  public.claim_blockchain_outbox(TEXT), public.finish_blockchain_outbox(TEXT, UUID, public.blockchain_status, TEXT, INTEGER),
  public.commit_farming_log(UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.guard_blockchain_outbox(), public.queue_harvest_proof(), public.queue_batch_proof() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
