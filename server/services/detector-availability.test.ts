/**
 * Verifica que las notas de los detectores se clasifiquen bien: lo que falta
 * por plan/extensión/tabla NO puede aparecer como fallo, y un error real NO
 * puede esconderse en la lista gris de "no disponible".
 */
import { describe, it, expect } from 'vitest';
import { classifyNote, splitNotes } from './detector-availability';

describe('classifyNote — capacidades ausentes', () => {
  const unavailableCases = [
    'hotQueries: pg_stat_statements extension not enabled',
    'retryQueueBacklog: billing_retry_queue table not present',
    'neon: Neon API 403: {"message":"This endpoint requires the Scale plan"}',
    'neon: NEON_API_KEY not set — compute metrics disabled',
    'neon: NEON_PROJECT_ID not set — compute metrics disabled',
    'costPerUser: usage_events table unavailable',
    'negativeBalances: wallets table/column unavailable',
    'byProduct: usage_events not available',
    'workers: worker_runs table not present (deploy the LeadPrime heartbeat migration)',
    'liveActivity: pg_stat_activity not accessible',
    'missingRecharges35d: invoices/wallet_transactions no disponible',
  ];

  for (const note of unavailableCases) {
    it(`marca como no disponible: ${note.slice(0, 48)}`, () => {
      expect(classifyNote(note).kind).toBe('unavailable');
    });
  }

  it('da el paso concreto para habilitar pg_stat_statements', () => {
    const c = classifyNote('hotQueries: pg_stat_statements extension not enabled');
    expect(c.detector).toBe('hotQueries');
    expect(c.enableWith).toMatch(/Neon/);
  });

  it('explica que la API de consumo de Neon es de plan Scale', () => {
    const c = classifyNote('neon: Neon API 403: forbidden');
    expect(c.kind).toBe('unavailable');
    expect(c.enableWith).toMatch(/Scale/);
  });
});

describe('classifyNote — fallos reales', () => {
  const issueCases = [
    'twilio: Twilio API 401: authentication failed',
    'anthropic: request failed: ETIMEDOUT',
    'infra: password authentication failed for user "neondb_owner"',
    'cogs.providers: Cannot read properties of undefined',
    'byProvider: syntax error at or near "SELECT"',
    'recurring: 3 cuenta(s) excluidas del MRR (sin mensualidad, duplicadas o demo)',
  ];

  for (const note of issueCases) {
    it(`mantiene como problema: ${note.slice(0, 48)}`, () => {
      expect(classifyNote(note).kind).toBe('issue');
    });
  }
});

describe('splitNotes', () => {
  it('separa las dos cubetas y deduplica', () => {
    const { issues, unavailable } = splitNotes([
      'hotQueries: pg_stat_statements extension not enabled',
      'hotQueries: pg_stat_statements extension not enabled',
      'twilio: Twilio API 401: authentication failed',
      'retryQueueBacklog: billing_retry_queue table not present',
    ]);
    expect(unavailable).toHaveLength(2);
    expect(issues).toEqual(['twilio: Twilio API 401: authentication failed']);
  });

  it('con solo capacidades ausentes, la lista de problemas queda vacía', () => {
    const { issues } = splitNotes([
      'hotQueries: pg_stat_statements extension not enabled',
      'retryQueueBacklog: billing_retry_queue table not present',
      'neon: Neon API 403: requires the Scale plan',
    ]);
    expect(issues).toEqual([]);
  });

  it('ignora entradas vacías', () => {
    expect(splitNotes(['', '   ']).issues).toEqual([]);
  });
});
