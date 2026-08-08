/**
 * La regla de duplicados decide qué cuentas SALEN del MRR y del conteo de
 * suscripciones. Un falso positivo borra ingreso real del tablero, así que el
 * criterio tiene que ser exacto y estable.
 */
import { describe, it, expect } from 'vitest';
import { phoneKey, accountGroupKey, findDuplicateAccounts } from '@shared/duplicate-accounts';

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

describe('findDuplicateAccounts', () => {
  it('marca la cuenta secundaria y conserva la del plan más caro', () => {
    const { duplicateIds, primaryOf } = findDuplicateAccounts([
      { id: 'gratis', phone: '+1 555-010-2030', name: 'Gloria', weight: 0 },
      { id: 'pro', phone: '5550102030', name: 'Gloria C', weight: 9900 },
    ]);
    expect(Array.from(duplicateIds)).toEqual(['gratis']);
    expect(primaryOf.get('gratis')).toBe('pro');
  });

  it('no marca cuentas distintas', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5550102030', name: 'Ana' },
      { id: 'b', phone: '5559998888', name: 'Beto' },
    ]);
    expect(duplicateIds.size).toBe(0);
  });

  it('no agrupa por dominio de correo (dos socios de la misma empresa son cuentas reales)', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5550000001', name: 'Ana', businessName: 'Fence Co' },
      { id: 'b', phone: '5550000002', name: 'Beto', businessName: 'Fence Co Sur' },
    ]);
    expect(duplicateIds.size).toBe(0);
  });

  it('agrupa por nombre de negocio cuando faltan los teléfonos', () => {
    const { duplicateIds, groupSize } = findDuplicateAccounts([
      { id: 'a', businessName: 'Casillas Fencing', weight: 6500 },
      { id: 'b', businessName: 'casillas fencing', weight: 0 },
    ]);
    expect(Array.from(duplicateIds)).toEqual(['b']);
    expect(groupSize.get('a')).toBe(2);
  });

  it('en un grupo de tres deja una principal y marca dos', () => {
    const { duplicateIds } = findDuplicateAccounts([
      { id: 'a', phone: '5551112222', weight: 100 },
      { id: 'b', phone: '555-111-2222', weight: 900 },
      { id: 'c', phone: '+1 555 111 2222', weight: 0 },
    ]);
    expect(duplicateIds.has('b')).toBe(false);
    expect(duplicateIds.size).toBe(2);
  });

  it('no toca cuentas sin datos de contacto', () => {
    const { duplicateIds } = findDuplicateAccounts([{ id: 'a' }, { id: 'b' }]);
    expect(duplicateIds.size).toBe(0);
  });
});
