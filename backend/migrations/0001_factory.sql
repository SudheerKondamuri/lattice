ALTER TABLE workspaces ADD COLUMN settings_revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE sources ADD COLUMN revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE sources ADD COLUMN ingestion_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE sources ADD COLUMN crawl_policy jsonb NOT NULL DEFAULT '{"maxPages":50,"excludePaths":[],"selectedUrls":[]}';
--> statement-breakpoint
CREATE FUNCTION bump_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.revision=OLD.revision+1; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER source_revision BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION bump_source_revision();
--> statement-breakpoint
ALTER TABLE assets ALTER COLUMN bytes DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE assets ADD COLUMN size_bytes integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE assets ADD COLUMN object_key text;
--> statement-breakpoint
ALTER TABLE assets ADD COLUMN storage_state text NOT NULL DEFAULT 'pending' CHECK(storage_state IN ('pending','stored','deleting','deleted'));
--> statement-breakpoint
UPDATE assets SET size_bytes=octet_length(bytes),object_key=workspace_id::text||'/'||source_id::text||'/'||id::text||'/original';
--> statement-breakpoint
ALTER TABLE assets ALTER COLUMN object_key SET NOT NULL;
--> statement-breakpoint
CREATE TABLE job_steps (
 workspace_id uuid NOT NULL, job_id uuid NOT NULL, stage text NOT NULL,
 state text NOT NULL CHECK(state IN ('running','succeeded','failed')), details jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 PRIMARY KEY(workspace_id,job_id,stage), FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN site_origin text;
--> statement-breakpoint
UPDATE sessions SET site_origin=origin;
--> statement-breakpoint
CREATE TABLE installations (
 workspace_id uuid NOT NULL, agent_id uuid NOT NULL, site_origin text NOT NULL,
 last_observed_at timestamptz NOT NULL DEFAULT now(), loader_version text NOT NULL,
 release_id uuid NOT NULL, session_count integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,agent_id,site_origin), FOREIGN KEY(workspace_id,agent_id) REFERENCES agents(workspace_id,id),
 FOREIGN KEY(workspace_id,release_id) REFERENCES releases(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE installation_sessions (
 workspace_id uuid NOT NULL, session_id uuid NOT NULL, PRIMARY KEY(workspace_id,session_id),
 FOREIGN KEY(workspace_id,session_id) REFERENCES sessions(workspace_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE revocations (
 workspace_id uuid NOT NULL, resource_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('source','conversation')),
 revoked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,kind,resource_id)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['job_steps','installations','installation_sessions','revocations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant ON %I USING (workspace_id=nullif(current_setting(''app.workspace_id'',true),'''')::uuid OR current_setting(''app.system'',true)=''on'') WITH CHECK (workspace_id=nullif(current_setting(''app.workspace_id'',true),'''')::uuid OR current_setting(''app.system'',true)=''on'')',t);
 END LOOP;
 -- Do not expose application tables through Supabase's automatically granted Data API roles.
 FOREACH t IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=t) THEN
 EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I',t);
 EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',t);
 END IF;
 END LOOP;
END $$;
