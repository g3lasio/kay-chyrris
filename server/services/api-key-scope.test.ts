/**
 * Distinguir "la key no sirve" de "la key no puede hacer ESTO".
 *
 * EL FALLO QUE FIJA ESTE ARCHIVO: la sonda pedía `GET /domains` (lectura) con
 * una key de Resend restringida a ENVÍO. Resend respondía 401
 * "restricted_api_key: This API key is restricted to only send emails" — que
 * dice que la key SOLO PUEDE ENVIAR, no que no pueda. El panel lo leyó como
 * caída, declaró "⛔ CANAL DE ALERTAS CAÍDO", acumuló cientos de fallos
 * consecutivos y recomendó rotar una credencial que estaba perfecta.
 */
import { describe, it, expect } from 'vitest';
import { classifyAuthFailure, isScopeLimited, scopeLimitedNote } from './api-key-scope';

describe('Resend — el caso exacto', () => {
  const body = JSON.stringify({
    statusCode: 401,
    name: 'restricted_api_key',
    message: 'This API key is restricted to only send emails',
  });

  it('NO es una caída: la key es válida con alcance acotado', () => {
    expect(classifyAuthFailure(401, body)).toBe('scope_limited');
    expect(isScopeLimited(401, body)).toBe(true);
  });

  it('reconoce el nombre del error aunque cambie el texto', () => {
    expect(isScopeLimited(401, '{"name":"restricted_api_key"}')).toBe(true);
  });
});

describe('Admin/Billing API con key de inferencia', () => {
  it('Anthropic: pedir la Admin API con una key normal no es una caída', () => {
    const body = '{"error":{"message":"This endpoint requires an Admin API key"}}';
    expect(isScopeLimited(401, body)).toBe(true);
  });

  it('OpenAI: permisos insuficientes tampoco', () => {
    const body = '{"error":{"message":"You have insufficient permissions for this operation"}}';
    expect(isScopeLimited(401, body)).toBe(true);
  });

  it('falta de scopes tampoco', () => {
    expect(isScopeLimited(403, '{"error":"missing scopes: billing.read"}')).toBe(true);
  });
});

describe('credenciales de verdad rechazadas — siguen siendo fallo', () => {
  it('key inválida', () => {
    expect(classifyAuthFailure(401, '{"error":{"message":"Invalid API key provided"}}')).toBe('rejected');
    expect(isScopeLimited(401, '{"error":{"message":"Invalid API key provided"}}')).toBe(false);
  });

  it('key revocada', () => {
    expect(classifyAuthFailure(401, '{"message":"API key revoked"}')).toBe('rejected');
  });

  it('authentication_error de Anthropic', () => {
    expect(classifyAuthFailure(401, '{"type":"authentication_error"}')).toBe('rejected');
  });

  it('una señal de rechazo GANA sobre una de alcance en el mismo cuerpo', () => {
    // Ante la duda, fallo real: silenciar uno de verdad es peor que una alerta de más.
    expect(classifyAuthFailure(401, 'invalid_api_key (insufficient scope)')).toBe('rejected');
  });

  it('un 401 sin pistas se trata como credencial rechazada', () => {
    expect(classifyAuthFailure(401, '')).toBe('rejected');
  });

  it('un 403 sin pistas se trata como permiso', () => {
    expect(classifyAuthFailure(403, '')).toBe('scope_limited');
  });
});

describe('límites', () => {
  it('solo aplica a 401/403', () => {
    expect(isScopeLimited(500, 'restricted_api_key')).toBe(false);
    expect(isScopeLimited(200, 'restricted_api_key')).toBe(false);
    expect(isScopeLimited(402, 'restricted_api_key')).toBe(false);
  });

  it('tolera cuerpo vacío o nulo', () => {
    expect(() => classifyAuthFailure(401, null)).not.toThrow();
    expect(() => classifyAuthFailure(401, undefined)).not.toThrow();
  });

  it('el texto para el panel dice que NO hay que rotar nada', () => {
    const note = scopeLimitedNote('Resend', 'leer dominios');
    expect(note).toMatch(/NO es una caída/i);
    expect(note).toMatch(/no hay que rotar/i);
  });
});
