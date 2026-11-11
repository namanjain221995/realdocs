import { useEffect, useSyncExternalStore } from 'react';
import {
  type Capability,
  type CapabilityPurpose,
  captureCapabilityFragment,
  dropCapability,
  getCapabilityVersion,
  readCapability,
  subscribeToCapabilities,
} from './capability';

// Drops are deferred by one task so that React's development-mode
// unmount/remount of effects does not throw the secret away mid-screen.
const scheduledDrops = new Map<string, number>();

function cancelDrop(key: string): void {
  const handle = scheduledDrops.get(key);
  if (handle !== undefined) {
    window.clearTimeout(handle);
    scheduledDrops.delete(key);
  }
}

/**
 * The capability secret held for a share or invitation link, for the screen
 * that exchanges it. The secret stays in memory while that screen is open and
 * is forgotten when it closes.
 */
export function useCapability(purpose: CapabilityPurpose, id: string): Capability {
  // Re-render when a capability is captured (the link was opened again) or dropped.
  useSyncExternalStore(subscribeToCapabilities, getCapabilityVersion, () => 0);

  useEffect(() => {
    const key = `${purpose}:${id}`;
    cancelDrop(key);
    // Normally already done at startup; this covers arriving here without a page load.
    captureCapabilityFragment();
    return () => {
      cancelDrop(key);
      scheduledDrops.set(
        key,
        window.setTimeout(() => {
          scheduledDrops.delete(key);
          dropCapability(purpose, id);
        }, 0),
      );
    };
  }, [purpose, id]);

  return readCapability(purpose, id);
}
