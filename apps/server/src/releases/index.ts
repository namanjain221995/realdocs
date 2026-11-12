import type { AppContext } from '../context';
import { ReleaseStore } from './store';

const stores = new WeakMap<AppContext, ReleaseStore>();

/** One store per application context, created on first use. */
export function releaseStoreFor(ctx: AppContext): ReleaseStore {
  let store = stores.get(ctx);
  if (!store) {
    store = new ReleaseStore(ctx.config.downloadDir, ctx.logger);
    stores.set(ctx, store);
  }
  return store;
}

export { ReleaseStore } from './store';
