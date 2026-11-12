/** Minimal cookie-jar API client (administrator or share-link guest). */
import { CSRF_HEADER } from '@realtimedocs/contracts';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
  ms: number;
}

export class Api {
  readonly cookies = new Map<string, string>();
  csrf: string | null = null;
  constructor(readonly origin: string) {}

  async request<T = any>(
    method: string,
    pathname: string,
    body?: unknown,
    raw?: { content: Uint8Array; contentType: string },
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { accept: 'application/json', ...extraHeaders };
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (method !== 'GET') {
      headers.origin = this.origin;
      headers[CSRF_HEADER] = this.csrf ?? '1';
    }
    let payload: BodyInit | undefined;
    if (raw) {
      headers['content-type'] = raw.contentType;
      payload = raw.content as BodyInit;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const t0 = performance.now();
    const response = await fetch(`${this.origin}${pathname}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });
    const text = await response.text();
    const ms = performance.now() - t0;
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed as T, text, headers: response.headers, ms };
  }

  async ok<T = any>(method: string, pathname: string, body?: unknown): Promise<T> {
    const r = await this.request<T>(method, pathname, body);
    if (r.status < 200 || r.status >= 300)
      throw new Error(`${method} ${pathname} -> ${r.status} ${r.text.slice(0, 200)}`);
    return r.body;
  }

  async login(email: string, password: string): Promise<void> {
    const r = await this.request<{ csrfToken: string }>('POST', '/api/auth/login', {
      email,
      password,
    });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${r.text.slice(0, 200)}`);
    this.csrf = r.body.csrfToken;
  }

  upload(documentId: string, content: Uint8Array, filename: string, contentType: string) {
    const boundary = `----rdload${Math.random().toString(16).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return this.request('POST', `/api/documents/${documentId}/assets`, undefined, {
      content: Buffer.concat([head, content, tail]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
  }
}
