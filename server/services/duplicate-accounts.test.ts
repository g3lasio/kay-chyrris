/**
 * La regla de duplicados decide qué cuentas SALEN de los conteos. La versión
 * anterior sacó del MRR a info@owlfenc.com — network_elite ACTIVA de $249/mes
 * con $996 de ingreso acumulado — solo porque coincidía de nombre con otra
 * cuenta de pago. Eso es borrar dinero real del tablero.
 *
 * REGLA DE ORO que verifican estos tests: ninguna cuenta con suscripción de
 * pago activa puede terminar en `duplicateIds`, pase lo que pase.
 */
import { describe, it, expect } from 'vitest';
import {
  phoneKey,
  accountGroupKey,
  findDuplicateAccounts,
  type DuplicateCandidate,
} from '@shared/duplicate-accounts';

describe('phoneKey', () => {
  it('iguala el mismo número escrito de formas distintas', () => {
    expect(phoneKey('+1 (555) 010-2030')).toBe('5550102030');
    expect(phoneKey('5550102030')).toBe('5550102030');
    expect(phoneKey('001-555-010-2030')).toBe('5550102030');
  });

  it('descarta números incompletos', () => {
    expect(phoneKey('555-0102')).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey('')).toBeNull();
  });
});

describe('accountGroupKey', () => {
  it('prefiere el teléfono sobre el nombre', () => {
    expect(accountGroupKey({ id: 'a', phone: '5550102030', name: 'Gloria' })).toBe('p:5550102030');
  });

  it('cae al nombre de negocio cuando no hay teléfono usable', () => {
    expect(accountGroupKey({ id: 'a', phone: null, businessName: '  Casillas Fencing ' }))
      .toBe('n:casillas fencing');
  });

  it('sin teléfono ni nombre no agrupa', () => {
    expect(accountGroupKey({ id: 'a' })).toBeNull();
  });
});

describe('findDuplicateAccounts — NUNCA se excluye una cuenta de pago', () => {
  // El caso real que rompió el tablero: dos cuentas del dueño, ambas de pago.
  const owlfenc: DuplicateCandidate = {
    id: 'owlfenc',
    name: 'Gelasio',
    businessName: 'Owl Fenc',
    phone: '5551112222',
    monthlyPriceCents: 24900, // network_elite ACTIVA
  };
  const proton: DuplicateCandidate = {
    id: 'proton',
    name: 'Gelasio',
    businessName: 'Owl Fenc',
    phone: '5551112222',
    monthlyPriceCents: 65000, // chyrris_growth
  };

  it('dos cuentas DE PAGO que coinciden: ninguna se excluye', () => {
    const { duplicateIds } = findDuplicateAccounts([owlfenc, proton]);
    expect(duplicateIds.has('owlfenc')).toBe(false);
    expect(duplicateIds.has('proton')).toBe(false);
    expect(duplicateIds.size).toBe(0);
  });

  it('las marca para revisión humana, con el grupo completo', () => {
    const { reviewIds, reviewGroups } = findDuplicateAccounts([owlfenc, proton]);
    expect(reviewIds.has('owlfenc')).toBe(true);
    expect(reviewIds.has('proton')).toBe(true);
    expect(reviewGroups).toHaveLength(1);
    expect(reviewGroups[0].ids.sort()).toEqual(['owlfenc', 'proton']);
  });

  it('los $249 de owlfenc siguen sumando al MRR', () => {
    const { duplicateIds } = findDuplicateAccounts([owlfenc, proton]);
    const mrr = [owlfenc, proton]
      .filter((c) => !duplicateIds.has(c.id))
      .reduce((s, c) => s + (c.monthlyPriceCents ?? 0), 0);
    expect(mrr).toBe(24900 + 65000); // nada se pierde
  });

  it('una cuenta de pago junto a una gratis: solo se excluye la gratis', () => {
    const { duplicateIds, reviewIds } = findDuplicateAccounts([
      { id: 'pro', phone: '5559990000', monthlyPriceCents: 9900 },
      { id: 'gratis', phone: '555-999-0000', monthlyPriceCents: 0 },
    ]);
    expect(Array.from(duplicateIds)).toEqual(['gratis']);
    expect(reviewIds.size).toBe(0); // una sola de pago: no hay nada que revisar
  });

  it('ninguna paga: se conserva una y se excluyen las demás (no mueve dinero)', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5551234567', monthlyPriceCents: 0 },
      { id: 'b', phone: '5551234567', monthlyPriceCents: 0 },
      { id: 'c', phone: '5551234567' },
    ]);
    expect(duplicateIds.size).toBe(2);
  });

  it('propiedad general: ninguna cuenta de pago cae nunca en duplicateIds', () => {
    const grupo: DuplicateCandidate[] = [
      { id: 'p1', phone: '5550000001', monthlyPriceCents: 65000 },
      { id: 'p2', phone: '5550000001', monthlyPriceCents: 24900 },
      { id: 'p3', phone: '5550000001', monthlyPriceCents: 1500 },
      { id: 'f1', phone: '5550000001', monthlyPriceCents: 0 },
      { id: 'f2', phone: '5550000001' },
    ];
    const { duplicateIds } = findDuplicateAccounts(grupo);
    for (const c of grupo.filter((x) => (x.monthlyPriceCents ?? 0) > 0)) {
      expect(duplicateIds.has(c.id)).toBe(false);
    }
    expect(Array.from(duplicateIds).sort()).toEqual(['f1', 'f2']);
  });
});

describe('findDuplicateAccounts — una cuenta no es duplicada de sí misma', () => {
  // MORENITA Management (truthbackpack@gmail.com) salió marcada sin compartir
  // nombre con nadie: la consulta del MRR hace LEFT JOIN con company_profiles y
  // contractor_subscription_config, y esas filas repetidas hacían que la MISMA
  // cuenta apareciera dos veces y se marcara duplicada de sí misma.
  it('filas repetidas del mismo id por el JOIN no marcan nada', () => {
    const { duplicateIds, reviewIds } = findDuplicateAccounts([
      { id: 'morenita', phone: '5551234567', businessName: 'MORENITA Management', monthlyPriceCents: 0 },
      { id: 'morenita', phone: '5551234567', businessName: 'MORENITA Management', monthlyPriceCents: 0 },
    ]);
    expect(duplicateIds.has('morenita')).toBe(false);
    expect(duplicateIds.size).toBe(0);
    expect(reviewIds.size).toBe(0);
  });

  it('tampoco cuando las filas repetidas traen precios distintos', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'x', phone: '5557778888', monthlyPriceCents: 0 },
      { id: 'x', phone: '5557778888', monthlyPriceCents: 65000 },
    ]);
    expect(duplicateIds.size).toBe(0);
  });
});

describe('findDuplicateAccounts — no marcar de más', () => {
  it('no marca cuentas distintas', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5550102030', name: 'Ana' },
      { id: 'b', phone: '5559998888', name: 'Beto' },
    ]);
    expect(duplicateIds.size).toBe(0);
  });

  it('no agrupa por dominio de correo (dos socios de la misma empresa son reales)', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5550000001', name: 'Ana', businessName: 'Fence Co' },
      { id: 'b', phone: '5550000002', name: 'Beto', businessName: 'Fence Co Sur' },
    ]);
    expect(duplicateIds.size).toBe(0);
  });

  it('no toca cuentas sin datos de contacto', () => {
    const { duplicateIds } = findDuplicateAccounts([{ id: 'a' }, { id: 'b' }]);
    expect(duplicateIds.size).toBe(0);
  });
});
