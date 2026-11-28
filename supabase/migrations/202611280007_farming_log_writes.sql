BEGIN;

ALTER TABLE public.farming_log_versions
  ADD COLUMN confirmed_by uuid REFERENCES public.user_profiles(id) ON DELETE RESTRICT;

UPDATE public.farming_log_versions v SET confirmed_by=v.corrected_by
FROM public.farming_logs l
WHERE l.id=v.farming_log_id AND l.lifecycle_status IN ('CONFIRMED','REVOKED')
  AND (v.version_number<l.current_version OR v.id=l.current_version_id)
  AND v.status IN ('ACTIVE','SUPERSEDED','REVOKED');

CREATE FUNCTION public.farming_log_response(p_log public.farming_logs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT to_jsonb(p_log) || jsonb_build_object(
    'author_name',a.full_name,'confirmed_by',v.confirmed_by,'confirmer_name',c.full_name,'confirmed_at',v.confirmed_at)
  FROM public.user_profiles a
  LEFT JOIN public.farming_log_versions v ON v.id=p_log.current_version_id
  LEFT JOIN public.user_profiles c ON c.id=v.confirmed_by
  WHERE a.id=p_log.created_by;
$$;

CREATE FUNCTION public.create_farming_log_draft(p_actor uuid,p_batch uuid,p_date timestamptz,
  p_type public.farming_log_type,p_details jsonb,p_image text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE pond uuid; result public.farming_logs;
BEGIN
  SELECT p.id INTO pond FROM public.ponds p JOIN public.batches b ON b.pond_id=p.id
    WHERE b.id=p_batch FOR UPDATE OF p;
  IF NOT FOUND OR NOT public.pond_can(p_actor,pond,'LOG_CREATE') THEN
    RAISE EXCEPTION 'Missing accessible batch' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.farming_logs(batch_id,created_by,log_date,log_type,details,image_url)
    VALUES(p_batch,p_actor,p_date,p_type,p_details,p_image) RETURNING * INTO result;
  PERFORM public.org_audit(p_actor,'FARMING_LOG',result.id,'CREATE',NULL,to_jsonb(result));
  RETURN public.farming_log_response(result);
END
$$;

CREATE FUNCTION public.farming_log_change_target(p_actor uuid,p_log uuid,p_updated_at timestamptz,p_mode text)
RETURNS public.farming_logs LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE pond uuid; previous public.farming_logs;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('EDIT','CONFIRM','CORRECT','REVOKE') THEN
    RAISE EXCEPTION 'Invalid log operation' USING ERRCODE='22023';
  END IF;
  SELECT p.id INTO pond FROM public.ponds p JOIN public.batches b ON b.pond_id=p.id
    JOIN public.farming_logs l ON l.batch_id=b.id WHERE l.id=p_log FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing log' USING ERRCODE='P0002'; END IF;
  IF (p_mode IN ('EDIT','CORRECT') AND NOT public.pond_can(p_actor,pond,'LOG_EDIT'))
    OR (p_mode IN ('CONFIRM','CORRECT','REVOKE') AND NOT public.pond_can(p_actor,pond,'LOG_CONFIRM')) THEN
    RAISE EXCEPTION 'Missing accessible log' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO previous FROM public.farming_logs WHERE id=p_log FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing log' USING ERRCODE='P0002'; END IF;
  IF previous.updated_at IS DISTINCT FROM p_updated_at
    OR (p_mode IN ('EDIT','CONFIRM') AND previous.lifecycle_status <> 'DRAFT')
    OR (p_mode IN ('CORRECT','REVOKE') AND (previous.lifecycle_status <> 'CONFIRMED' OR previous.current_version_id IS NULL)) THEN
    RAISE EXCEPTION 'Log changed' USING ERRCODE='PT409';
  END IF;
  RETURN previous;
END
$$;

CREATE FUNCTION public.farming_log_anchor_event(p_log public.farming_logs,p_mode text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT 'FARMING_LOG_RECORDED:' || p_log.id || CASE p_mode
    WHEN 'CORRECT' THEN ':v' || (p_log.current_version + 1)
    WHEN 'REVOKE' THEN ':revoke:v' || p_log.current_version
    ELSE ''
  END;
$$;

-- Reserve the event hash while the pond and log are locked. A retry may submit the
-- same proof after a network failure. An edit cannot change its target meanwhile.
CREATE FUNCTION public.reserve_farming_log_anchor(p_actor uuid,p_log uuid,p_updated_at timestamptz,p_mode text,p_hash text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE previous public.farming_logs; event text; competing text; count_events integer; anchor_hash text;
BEGIN
  IF p_mode NOT IN ('CONFIRM','CORRECT','REVOKE') OR p_mode IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid log proof' USING ERRCODE='22023';
  END IF;
  previous := public.farming_log_change_target(p_actor,p_log,p_updated_at,p_mode);
  event := public.farming_log_anchor_event(previous,p_mode);
  competing := CASE p_mode
    WHEN 'CORRECT' THEN public.farming_log_anchor_event(previous,'REVOKE')
    WHEN 'REVOKE' THEN public.farming_log_anchor_event(previous,'CORRECT')
  END;
  IF competing IS NOT NULL AND EXISTS(SELECT FROM public.blockchain_records WHERE event_id=competing) THEN
    RAISE EXCEPTION 'Another log transition has a reserved proof' USING ERRCODE='PT409';
  END IF;
  SELECT count(*),min(data_hash) INTO count_events,anchor_hash FROM public.blockchain_records WHERE event_id=event;
  IF count_events>1 OR (count_events=1 AND anchor_hash IS DISTINCT FROM p_hash) THEN
    RAISE EXCEPTION 'Log proof already has different data' USING ERRCODE='PT409';
  END IF;
  IF count_events=0 THEN
    INSERT INTO public.blockchain_records(batch_id,entity_type,entity_id,event_type,event_id,data_hash,status)
      VALUES(previous.batch_id,'FARMING_LOG',p_log,'FARMING_LOG_RECORDED',event,p_hash,'PENDING');
  END IF;
  RETURN event;
END
$$;

CREATE FUNCTION public.apply_farming_log_change(p_actor uuid,p_log uuid,p_updated_at timestamptz,p_mode text,
  p_changes jsonb,p_version uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE previous public.farming_logs; result public.farming_logs; v public.farming_log_versions;
  event text; anchor_hash text; expected_version int; action public.audit_action;
BEGIN
  previous := public.farming_log_change_target(p_actor,p_log,p_updated_at,p_mode);
  event := public.farming_log_anchor_event(previous,p_mode);
  IF p_mode='EDIT' THEN
    IF EXISTS(SELECT FROM public.blockchain_records WHERE event_id=event) THEN
      RAISE EXCEPTION 'Draft already has a reserved proof' USING ERRCODE='PT409';
    END IF;
    UPDATE public.farming_logs SET log_date=(p_changes->>'log_date')::timestamptz,
      log_type=(p_changes->>'log_type')::public.farming_log_type, details=p_changes->'details', image_url=p_changes->>'image_url'
      WHERE id=p_log RETURNING * INTO result;
    action := 'UPDATE';
  ELSE
    SELECT data_hash INTO anchor_hash FROM public.blockchain_records WHERE event_id=event AND status='SUCCESS';
    IF NOT FOUND THEN RAISE EXCEPTION 'Log proof has not been confirmed' USING ERRCODE='PT409'; END IF;
    IF p_mode='REVOKE' THEN
      IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE='22023';
      END IF;
      UPDATE public.farming_log_versions SET status='REVOKED',revoked_by=p_actor,revoked_at=clock_timestamp(),revocation_reason=p_reason
        WHERE id=previous.current_version_id AND status='ACTIVE';
      IF NOT FOUND THEN RAISE EXCEPTION 'Log version changed' USING ERRCODE='PT409'; END IF;
      UPDATE public.farming_logs SET lifecycle_status='REVOKED' WHERE id=p_log RETURNING * INTO result;
      action := 'REVOKE';
    ELSE
      expected_version := previous.current_version + CASE WHEN p_mode='CORRECT' THEN 1 ELSE 0 END;
      SELECT * INTO v FROM public.farming_log_versions
        WHERE id=p_version AND farming_log_id=p_log AND version_number=expected_version
          AND blockchain_event_id=event AND data_hash=anchor_hash AND status='ACTIVE'
          AND supersedes_version_id IS NOT DISTINCT FROM previous.current_version_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Anchored log version does not match' USING ERRCODE='PT409'; END IF;
      IF p_mode='CORRECT' THEN
        UPDATE public.farming_log_versions SET status='SUPERSEDED' WHERE id=previous.current_version_id AND status='ACTIVE';
        IF NOT FOUND THEN RAISE EXCEPTION 'Log version changed' USING ERRCODE='PT409'; END IF;
      END IF;
      UPDATE public.farming_log_versions SET confirmed_by=p_actor,confirmed_at=clock_timestamp() WHERE id=v.id;
      UPDATE public.farming_logs SET log_date=v.log_date,log_type=v.log_type,details=v.details,image_url=v.image_url,
        data_hash=v.data_hash,tx_hash=v.tx_hash,current_version=v.version_number,current_version_id=v.id,lifecycle_status='CONFIRMED'
        WHERE id=p_log RETURNING * INTO result;
      action := CASE WHEN p_mode='CONFIRM' THEN 'CONFIRM'::public.audit_action ELSE 'UPDATE'::public.audit_action END;
    END IF;
  END IF;
  PERFORM public.org_audit(p_actor,'FARMING_LOG',p_log,action,to_jsonb(previous),to_jsonb(result));
  RETURN public.farming_log_response(result);
END
$$;

REVOKE ALL ON FUNCTION
  public.farming_log_response(public.farming_logs),
  public.create_farming_log_draft(uuid,uuid,timestamptz,public.farming_log_type,jsonb,text),
  public.farming_log_change_target(uuid,uuid,timestamptz,text),
  public.farming_log_anchor_event(public.farming_logs,text),
  public.reserve_farming_log_anchor(uuid,uuid,timestamptz,text,text),
  public.apply_farming_log_change(uuid,uuid,timestamptz,text,jsonb,uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.farming_log_response(public.farming_logs),
  public.create_farming_log_draft(uuid,uuid,timestamptz,public.farming_log_type,jsonb,text),
  public.farming_log_change_target(uuid,uuid,timestamptz,text),
  public.farming_log_anchor_event(public.farming_logs,text),
  public.reserve_farming_log_anchor(uuid,uuid,timestamptz,text,text),
  public.apply_farming_log_change(uuid,uuid,timestamptz,text,jsonb,uuid,text)
TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
