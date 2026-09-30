CREATE OR REPLACE FUNCTION release_eligible(w uuid,s uuid,r uuid,draft boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE deps AS (
 SELECT s AS id UNION SELECT d.dependency_id FROM release_dependencies d JOIN deps ON d.source_id=deps.id WHERE d.workspace_id=w AND d.release_id=r
 ) SELECT EXISTS(SELECT 1 FROM sources root WHERE root.workspace_id=w AND root.id=s AND root.status='active' AND (NOT root.held OR draft)) AND NOT EXISTS(
 SELECT 1 FROM deps LEFT JOIN sources x ON x.workspace_id=w AND x.id=deps.id
 WHERE x.id IS NULL OR x.status<>'active' OR (x.held AND NOT draft)
 );
$$;
