CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_id uuid NOT NULL,
 retention_days integer NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 30),
 spend_limit bigint NOT NULL DEFAULT 10000000 CHECK(spend_limit >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE memberships (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id uuid NOT NULL,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('owner','member')), PRIMARY KEY(workspace_id,user_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX one_owner ON memberships(workspace_id) WHERE role='owner';
--> statement-breakpoint
CREATE TABLE invitations (workspace_id uuid NOT NULL REFERENCES workspaces(id), email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,email));
--> statement-breakpoint
CREATE TABLE agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id),
 draft_config jsonb NOT NULL, draft_revision integer NOT NULL DEFAULT 1, published_release_id uuid, UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), title text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('website','sitemap','pdf','text','markdown','qa_csv','qa_xlsx','approved_answer')), url text,
 authority text NOT NULL CHECK(authority IN ('approved','authoritative','reference')), approval_required boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')), held boolean NOT NULL DEFAULT false,
 draft_version_id uuid, processing_state text NOT NULL DEFAULT 'queued' CHECK(processing_state IN ('queued','processing','ready','partial','failed')),
 warnings jsonb NOT NULL DEFAULT '[]', last_checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE source_dependencies (
 workspace_id uuid NOT NULL, source_id uuid NOT NULL, dependency_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,source_id,dependency_id), CHECK(source_id<>dependency_id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id), FOREIGN KEY(workspace_id,dependency_id) REFERENCES sources(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, source_id uuid NOT NULL,
 bytes bytea NOT NULL, media_type text NOT NULL, filename text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE source_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, source_id uuid NOT NULL,
 content_hash text NOT NULL, content text NOT NULL, page_count integer NOT NULL CHECK(page_count > 0),
 warnings jsonb NOT NULL DEFAULT '[]', refs jsonb NOT NULL DEFAULT '[]', asset_id uuid, creation_tx bigint NOT NULL DEFAULT txid_current(),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,source_id,id), UNIQUE(workspace_id,source_id,content_hash),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id), FOREIGN KEY(workspace_id,asset_id) REFERENCES assets(workspace_id,id)
);
--> statement-breakpoint
ALTER TABLE sources ADD FOREIGN KEY(workspace_id,draft_version_id) REFERENCES source_versions(workspace_id,id);
--> statement-breakpoint
ALTER TABLE sources ADD FOREIGN KEY(workspace_id,id,draft_version_id) REFERENCES source_versions(workspace_id,source_id,id);
--> statement-breakpoint
CREATE TABLE chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, source_id uuid NOT NULL, source_version_id uuid NOT NULL,
 ordinal integer NOT NULL, content text NOT NULL, reference jsonb NOT NULL DEFAULT '{}', embedding vector(1536) NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,source_version_id,ordinal),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id), FOREIGN KEY(workspace_id,source_id,source_version_id) REFERENCES source_versions(workspace_id,source_id,id)
);
--> statement-breakpoint
CREATE INDEX chunks_lexical ON chunks USING gin(search);
--> statement-breakpoint
CREATE INDEX chunks_vector ON chunks USING hnsw(embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX chunks_tenant_version ON chunks(workspace_id,source_version_id);
--> statement-breakpoint
CREATE TABLE releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, label text NOT NULL, config jsonb NOT NULL,
 draft_revision integer NOT NULL, creation_tx bigint NOT NULL DEFAULT txid_current(), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
--> statement-breakpoint
ALTER TABLE agents ADD FOREIGN KEY(workspace_id,published_release_id) REFERENCES releases(workspace_id,id);
--> statement-breakpoint
CREATE TABLE release_sources (
 workspace_id uuid NOT NULL, release_id uuid NOT NULL, source_id uuid NOT NULL, source_version_id uuid NOT NULL,
 title text NOT NULL, authority text NOT NULL, approval_required boolean NOT NULL,
 PRIMARY KEY(workspace_id,release_id,source_id), FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id), FOREIGN KEY(workspace_id,source_id,source_version_id) REFERENCES source_versions(workspace_id,source_id,id)
);
--> statement-breakpoint
CREATE TABLE publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, release_id uuid NOT NULL, previous_release_id uuid,
 actor_id uuid, mode text NOT NULL, checks jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE release_dependencies (
 workspace_id uuid NOT NULL, release_id uuid NOT NULL, source_id uuid NOT NULL, dependency_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,release_id,source_id,dependency_id), FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id), FOREIGN KEY(workspace_id,dependency_id) REFERENCES sources(workspace_id,id)
);
--> statement-breakpoint
CREATE FUNCTION immutable_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Release snapshots are immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER release_immutable BEFORE UPDATE OR DELETE ON releases FOR EACH ROW EXECUTE FUNCTION immutable_release();
--> statement-breakpoint
CREATE TRIGGER release_sources_immutable BEFORE UPDATE OR DELETE ON release_sources FOR EACH ROW EXECUTE FUNCTION immutable_release();
--> statement-breakpoint
CREATE TRIGGER release_dependencies_immutable BEFORE UPDATE OR DELETE ON release_dependencies FOR EACH ROW EXECUTE FUNCTION immutable_release();
--> statement-breakpoint
CREATE FUNCTION seal_release_children() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM releases WHERE workspace_id=NEW.workspace_id AND id=NEW.release_id AND creation_tx=txid_current()) THEN RAISE EXCEPTION 'Release snapshots are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER release_sources_sealed BEFORE INSERT ON release_sources FOR EACH ROW EXECUTE FUNCTION seal_release_children();
--> statement-breakpoint
CREATE TRIGGER release_dependencies_sealed BEFORE INSERT ON release_dependencies FOR EACH ROW EXECUTE FUNCTION seal_release_children();
--> statement-breakpoint
CREATE FUNCTION immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM sources WHERE workspace_id=OLD.workspace_id AND id=OLD.source_id AND status='deleted')
 AND NEW.content='' AND NEW.asset_id IS NULL AND NEW.refs='[]'::jsonb
 AND (to_jsonb(NEW)-'content'-'asset_id'-'refs')=(to_jsonb(OLD)-'content'-'asset_id'-'refs') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Source versions are immutable except deletion redaction';
END $$;
--> statement-breakpoint
CREATE TRIGGER source_version_immutable BEFORE UPDATE OR DELETE ON source_versions FOR EACH ROW EXECUTE FUNCTION immutable_version();
--> statement-breakpoint
CREATE FUNCTION immutable_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM sources WHERE workspace_id=OLD.workspace_id AND id=OLD.source_id AND status='deleted') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Chunks are immutable except source deletion';
END $$;
--> statement-breakpoint
CREATE TRIGGER chunks_immutable BEFORE UPDATE OR DELETE ON chunks FOR EACH ROW EXECUTE FUNCTION immutable_chunk();
--> statement-breakpoint
CREATE FUNCTION seal_version_chunks() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM source_versions WHERE workspace_id=NEW.workspace_id AND id=NEW.source_version_id AND source_id=NEW.source_id AND creation_tx=txid_current()) THEN RAISE EXCEPTION 'Source version chunks are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER chunks_sealed BEFORE INSERT ON chunks FOR EACH ROW EXECUTE FUNCTION seal_version_chunks();
--> statement-breakpoint
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('preview','visitor','evaluation')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, agent_id uuid NOT NULL, conversation_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE, origin text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL, release_id uuid,
 disposition text CHECK(disposition IN ('answer','clarification','handoff')), evidence jsonb NOT NULL DEFAULT '[]',
 model text, prompt_version text, input_tokens integer, output_tokens integer, latency_ms integer,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX messages_conversation ON messages(workspace_id,conversation_id,created_at);
--> statement-breakpoint
CREATE INDEX messages_search ON messages USING gin(to_tsvector('english',content));
--> statement-breakpoint
CREATE TABLE feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, message_id uuid NOT NULL,
 actor_key text NOT NULL, rating text NOT NULL CHECK(rating IN ('helpful','unhelpful')), comment text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,message_id,actor_key),
 FOREIGN KEY(workspace_id,message_id) REFERENCES messages(workspace_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE escalations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, conversation_id uuid NOT NULL,
 email text NOT NULL, name text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')), attempts integer NOT NULL DEFAULT 0,
 provider_id text, delivery_payload jsonb, first_attempt_at timestamptz, last_error text, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE eval_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, input jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1, frozen boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE eval_case_revisions (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, revision integer NOT NULL, input jsonb NOT NULL, actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,case_id,revision), FOREIGN KEY(workspace_id,case_id) REFERENCES eval_cases(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), session_id uuid,
 kind text NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed')),
 payload jsonb NOT NULL, result jsonb, error jsonb, attempts integer NOT NULL DEFAULT 0,
 max_attempts integer NOT NULL DEFAULT 3, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token uuid,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX jobs_claim ON jobs(state,available_at,lease_until);
--> statement-breakpoint
CREATE TABLE eval_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, release_id uuid NOT NULL, job_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued', limitations jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id), FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE eval_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, case_id uuid NOT NULL,
 case_snapshot jsonb NOT NULL, answer jsonb, deterministic jsonb NOT NULL DEFAULT '{"missingFacts":[],"eligibleCitations":false}',
 preliminary_grade jsonb, human_verdict text, reviewed_by uuid, error text,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,run_id,case_id), FOREIGN KEY(workspace_id,run_id) REFERENCES eval_runs(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES eval_cases(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE subscriptions (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), plan text NOT NULL DEFAULT 'trial' CHECK(plan IN ('trial','starter','growth')),
 status text NOT NULL DEFAULT 'trialing', customer_id text UNIQUE, subscription_id text UNIQUE,
 period_start timestamptz NOT NULL DEFAULT now(), period_end timestamptz NOT NULL DEFAULT now()+interval '14 days',
 webhook_created bigint NOT NULL DEFAULT 0, automatic_overages boolean NOT NULL DEFAULT false CHECK(NOT automatic_overages)
);
--> statement-breakpoint
CREATE TABLE usage_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, operation_key text NOT NULL, kind text NOT NULL,
 state text NOT NULL CHECK(state IN ('reserved','committed','released')), units integer NOT NULL DEFAULT 1 CHECK(units>=0),
 reserve_micros bigint NOT NULL CHECK(reserve_micros>=0), spent_micros bigint NOT NULL DEFAULT 0 CHECK(spent_micros>=0),
 period_start timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,operation_key), UNIQUE(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX usage_period ON usage_events(workspace_id,period_start,state,kind);
--> statement-breakpoint
CREATE TABLE spend_days (day date PRIMARY KEY, reserved_micros bigint NOT NULL DEFAULT 0, spent_micros bigint NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE idempotency (
 workspace_id uuid NOT NULL, actor_key text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_key,key)
);
--> statement-breakpoint
CREATE TABLE bootstrap_keys (user_id uuid NOT NULL, key text NOT NULL, fingerprint text NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id), PRIMARY KEY(user_id,key));
--> statement-breakpoint
CREATE TABLE stripe_events (id text PRIMARY KEY, type text NOT NULL, created bigint NOT NULL, received_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, kind text NOT NULL, summary text NOT NULL,
 batch_key text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,batch_key)
);
--> statement-breakpoint
CREATE TABLE rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);
--> statement-breakpoint
CREATE TABLE worker_heartbeats (id text PRIMARY KEY, last_seen timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE schedule_days (day date PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE FUNCTION source_eligible(w uuid,s uuid, draft boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE deps AS (
 SELECT s AS id UNION SELECT d.dependency_id FROM source_dependencies d JOIN deps ON d.source_id=deps.id WHERE d.workspace_id=w
 ) SELECT EXISTS(SELECT 1 FROM sources WHERE workspace_id=w AND id=s) AND NOT EXISTS(
 SELECT 1 FROM deps LEFT JOIN sources x ON x.workspace_id=w AND x.id=deps.id
 WHERE x.id IS NULL OR x.status<>'active' OR (x.held AND NOT draft))
$$;
--> statement-breakpoint
CREATE FUNCTION release_eligible(w uuid,s uuid,r uuid,draft boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE deps AS (
 SELECT s AS id UNION SELECT d.dependency_id FROM release_dependencies d JOIN deps ON d.source_id=deps.id WHERE d.workspace_id=w AND d.release_id=r
 ) SELECT source_eligible(w,s,draft) AND NOT EXISTS(
 SELECT 1 FROM deps LEFT JOIN sources x ON x.workspace_id=w AND x.id=deps.id
 WHERE x.id IS NULL OR x.status<>'active' OR (x.held AND NOT draft))
$$;
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agents','sources','source_dependencies','assets','source_versions','chunks','releases','release_sources','release_dependencies','publications','conversations','sessions','messages','feedback','escalations','eval_cases','eval_case_revisions','jobs','eval_runs','eval_results','subscriptions','usage_events','idempotency','notifications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid OR current_setting(''app.system'',true)=''on'') WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid OR current_setting(''app.system'',true)=''on'')',t);
 END LOOP;
END $$;
