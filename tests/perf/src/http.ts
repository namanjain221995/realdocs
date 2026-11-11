/** Minimal cookie-jar API client for the benchmark (administrator or share-link guest). */
import { CSRF_HEADER } from '@realtimedocs/contracts';
import { HOST } from './common';

export class Api {
  readonly cookies = new Map<string, string>();
  csrf: string | null = null;
  constructor(readonly port: number) {}

  get origin(): string {
    return `http://${HOST}:${this.port}`;
  }

  async request<T>(
    method: string,
    pathname: string,
    body?: unknown,
    raw?: { content: Uint8Array; contentType: string },
  ): Promise<{ status: number; body: T; text: string }> {
    const headers: Record<string, string> = { accept: 'application/json' };
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
    const response = await fetch(`${this.origin}${pathname}`, {
      method,
      headers,
      body: payload,
      redirect: 'manual',
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    const text = await response.text();
    const parse = (): unknown => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    };
    return { status: response.status, body: parse() as T, text };
  }

  async ok<T>(method: string, pathname: string, body?: unknown): Promise<T> {
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
    if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
    this.csrf = r.body.csrfToken;
  }

  /** Multipart upload of one file, exactly as the editor does it. */
  upload(documentId: string, content: Uint8Array, filename: string, contentType: string) {
    const boundary = `----rdperf${Math.random().toString(16).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return this.request<{
      asset: { id: string; sizeBytes: number; width: number | null; height: number | null };
    }>('POST', `/api/documents/${documentId}/assets`, undefined, {
      content: Buffer.concat([head, content, tail]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
  }
}
