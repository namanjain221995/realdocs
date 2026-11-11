/**
 * Behind a TLS-terminating proxy (PUBLIC_ORIGIN is https, TRUST_PROXY is set):
 * a visitor who arrived over plain HTTP is sent to the HTTPS origin, API calls
 * in clear text are refused, and requests that never passed a proxy (the
 * container health check) keep working.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestServer } from './harness';

const PUBLIC_ORIGIN = 'https://docs.example.test';

let server: TestServer;

function get(pathname: string, headers: Record<string, string> = {}, method = 'GET') {
  return fetch(`${server.origin}${pathname}`, { method, headers, redirect: 'manual' });
}

beforeAll(async () => {
  server = await TestServer.create('proxy', {
    port: 4412,
    env: { PUBLIC_ORIGIN, TRUST_PROXY: '1', ALLOWED_ORIGINS: '' },
  });
  await server.start();
});

afterAll(async () => {
  await server.dispose();
});

describe('plain HTTP in front of a TLS-terminating proxy', () => {
  it('redirects a page request that arrived over plain HTTP to the HTTPS origin', async () => {
    const response = await get('/d/some-document?x=1', { 'x-forwarded-proto': 'http' });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/d/some-document?x=1`);
    expect(await response.text()).not.toContain('<script');
  });

  it('redirects HEAD the same way', async () => {
    const response = await get('/', { 'x-forwarded-proto': 'http' }, 'HEAD');
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it('never redirects to another host, whatever the path looks like', async () => {
    const response = await get('//attacker.example/path', { 'x-forwarded-proto': 'http' });
    expect(response.status).toBe(308);
    const location = response.headers.get('location') ?? '';
    expect(new URL(location).origin).toBe(PUBLIC_ORIGIN);
  });

  it('refuses API calls that arrived over plain HTTP', async () => {
    const health = await get('/api/health', { 'x-forwarded-proto': 'http' });
    expect(health.status).toBe(403);
    expect(((await health.json()) as { error: { code: string } }).error.code).toBe('forbidden');

    const login = await fetch(`${server.origin}/api/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'x-forwarded-proto': 'http',
        'content-type': 'application/json',
        origin: PUBLIC_ORIGIN,
        'x-rd-csrf': '1',
      },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'not-a-real-password' }),
    });
    expect(login.status).toBe(403);
    expect(login.headers.get('set-cookie')).toBeNull();
  });

  it('serves requests the proxy received over HTTPS', async () => {
    const page = await get('/', { 'x-forwarded-proto': 'https' });
    expect(page.status).toBe(200);
    expect(page.headers.get('strict-transport-security')).toContain('max-age=');
    const health = await get('/api/health', { 'x-forwarded-proto': 'https' });
    expect(health.status).toBe(200);
  });

  it('leaves requests without the header alone (container health check, loopback)', async () => {
    const health = await get('/api/health');
    expect(health.status).toBe(200);
    const page = await get('/');
    expect(page.status).toBe(200);
  });
});
