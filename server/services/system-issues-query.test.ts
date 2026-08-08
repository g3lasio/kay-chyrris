/**
 * La consulta agrupada de System Issues, verificada contra un Postgres REAL.
 *
 * POR QUÉ ESTE TEST EXISTE: la primera versión usaba
 * `COUNT(DISTINCT contractor_id) OVER (PARTITION BY grp)`. Postgres no
 * implementa DISTINCT en window functions (SQLSTATE 0A000), así que la consulta
 * reventaba entera en producción — con los contadores mostrando 139 issues y la
 * lista diciendo "el agente no ha reportado nada". Un test de tipos no lo
 * detecta: el SQL solo se valida cuando lo ejecuta un motor de verdad.
 *
 * Por eso aquí se levanta (o se reutiliza) un Postgres y se EJECUTA la consulta.
 * Si no hay Postgres disponible, los tests que necesitan motor se saltan de
 * forma explícita — nunca pasan en verde fingiendo que verificaron algo.
 *
 * Para correrlo con base:  TEST_PG_URL=postgres://... npx vitest run
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { buildGroupedIssuesQuery } from './leadprime-db';

const TEST_PG_URL = process.env.TEST_PG_URL;

// Expresión de agrupación equivalente a la de producción (dedup_key + firma).
const GROUP_EXPR = `COALESCE(NULLIF(dedup_key, ''),
  COALESCE(tool_name, '') || '|' || LEFT(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(COALESCE(NULLIF(error_message, ''), title)),
            'https?://[^[:space:]]+', '<url>', 'g'),
          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g'),
        '[0-9]+', '<n>', 'g'),
      '[[:space:]]+', ' ', 'g'),
    300))`;

describe('buildGroupedIssuesQuery — forma del SQL (sin base de datos)', () => {
  const sql = buildGroupedIssuesQuery(GROUP_EXPR, '', 0);

  it('NO usa DISTINCT dentro de una window function (Postgres no lo implementa)', () => {
    // Busca el patrón exacto que rompió producción: COUNT(DISTINCT …) OVER (…)
    const distinctInWindow = /\b(count|sum|avg|min|max)\s*\(\s*distinct[^)]*\)\s*over\s*\(/is;
    expect(distinctInWindow.test(sql)).toBe(false);
  });

  it('calcula los agregados del grupo con GROUP BY, donde DISTINCT sí es válido', () => {
    expect(sql).toMatch(/grp_stats AS \(/);
    expect(sql).toMatch(/COUNT\(DISTINCT contractor_id\)/);
    expect(sql).toMatch(/GROUP BY grp/);
  });

  it('une por IS NOT DISTINCT FROM para no perder el grupo con grp NULL', () => {
    expect(sql).toMatch(/s\.grp IS NOT DISTINCT FROM r\.grp/);
  });

  it('numera los parámetros de LIMIT/OFFSET después de los filtros', () => {
    expect(buildGroupedIssuesQuery(GROUP_EXPR, 'WHERE status = $1', 1))
      .toMatch(/LIMIT \$2 OFFSET \$3/);
  });
});

describe.skipIf(!TEST_PG_URL)('buildGroupedIssuesQuery — ejecución real en Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_PG_URL });
    await pool.query(`DROP TABLE IF EXISTS system_issues`);
    await pool.query(`
      CREATE TABLE system_issues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id VARCHAR(255),
        tool_name VARCHAR(255),
        issue_type VARCHAR(50) NOT NULL DEFAULT 'bug',
        title TEXT NOT NULL,
        description TEXT,
        error_message TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        occurrences INTEGER NOT NULL DEFAULT 1,
        affected_contractors JSONB DEFAULT '[]',
        dedup_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // Reproduce producción: 134 reportes del MISMO fallo con texto variable
    // (códigos NAICS distintos) repartidos entre 7 contratistas + 5 resueltos.
    await pool.query(`
      INSERT INTO system_issues (contractor_id, tool_name, issue_type, title, error_message, status)
      SELECT 'contractor-' || (i % 7), 'samGovService.searchGovOpportunities', 'config_error',
             '[GovPrime] SAM.gov fetch failed for all NAICS codes (2389' || i || ')',
             'SAM.gov request failed (NAICS 2389' || i || '): HTTP 429 — throttled', 'new'
        FROM generate_series(1, 134) i`);
    await pool.query(`
      INSERT INTO system_issues (contractor_id, tool_name, issue_type, title, error_message, status)
      SELECT 'c9', 'lead_upsert', 'bug', 'otro fallo', 'column "foo" does not exist', 'resolved'
        FROM generate_series(1, 5) i`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('la consulta EJECUTA sin error (esto es lo que fallaba en producción)', async () => {
    const res = await pool.query(buildGroupedIssuesQuery(GROUP_EXPR, '', 0), [50, 0]);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it('139 filas se muestran como 2 grupos, no como lista vacía', async () => {
    const res = await pool.query(buildGroupedIssuesQuery(GROUP_EXPR, '', 0), [50, 0]);
    expect(res.rows).toHaveLength(2);
  });

  it('suma las ocurrencias y cuenta los contratistas distintos del grupo', async () => {
    const res = await pool.query(buildGroupedIssuesQuery(GROUP_EXPR, '', 0), [50, 0]);
    const samgov = res.rows.find((r: any) => r.tool_name?.includes('samGov'));
    expect(Number(samgov.grp_occurrences)).toBe(134);
    expect(Number(samgov.grp_rows)).toBe(134);
    expect(Number(samgov.grp_contractors)).toBe(7);
  });

  it('el filtro por status sigue devolviendo filas', async () => {
    const res = await pool.query(buildGroupedIssuesQuery(GROUP_EXPR, 'WHERE status = $1', 1), [
      'resolved',
      50,
      0,
    ]);
    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0].grp_occurrences)).toBe(5);
  });

  it('un issue sin herramienta ni mensaje no desaparece (grp NULL)', async () => {
    await pool.query(
      `INSERT INTO system_issues (contractor_id, tool_name, issue_type, title, error_message, status)
       VALUES ('c1', NULL, 'bug', 'sin herramienta', NULL, 'new')`
    );
    const res = await pool.query(buildGroupedIssuesQuery(GROUP_EXPR, '', 0), [50, 0]);
    expect(res.rows.some((r: any) => r.title === 'sin herramienta')).toBe(true);
  });
});
