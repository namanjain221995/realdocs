/** PostgreSQL container of the integration suite (server agent scratch range). */
export const PG = {
  container: 'rd-srv-pg-test',
  image: 'postgres:17.11-alpine',
  host: '127.0.0.1',
  port: 54410,
  user: 'rd',
  password: 'rd-integration-only',
  get admin() {
    return {
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database: 'postgres',
    };
  },
  url(database: string): string {
    return `postgres://${this.user}:${this.password}@${this.host}:${this.port}/${database}`;
  },
};

/**
 * Runs a docker command, retrying while the host port is momentarily taken.
 * (54410 lies in the ephemeral port range, so an unrelated outgoing connection
 * on this host can hold it for an instant.)
 */
export async function dockerRetry(
  run: () => void,
  cleanup: () => void = () => undefined,
  attempts = 20,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run();
      return;
    } catch (error) {
      const text = `${String((error as { stderr?: unknown }).stderr ?? '')} ${String(error)}`;
      if (attempt >= attempts || !/address already in use|port is already allocated/i.test(text)) {
        throw error;
      }
      cleanup();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
