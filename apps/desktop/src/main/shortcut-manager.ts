/**
 * Registers the three global shortcuts and keeps an honest record of which
 * ones the operating system actually accepted.
 *
 * Electron's `globalShortcut.register` returns `false` (and `isRegistered`
 * stays `false`) when another application already owns the combination, so a
 * registration is only reported as working after both agree.
 *
 * Changing a shortcut is transactional: if the new combination cannot be
 * registered, the previous one is put back, so a failed rebinding never costs
 * the user a working recovery shortcut.
 *
 * No Electron import: the registrar is injected.
 */
import {
  SHORTCUT_ACTIONS,
  acceleratorKeyCaps,
  defaultShortcuts,
  parseAccelerator,
  type AcceleratorError,
  type DesktopPlatform,
  type ShortcutAction,
  type ShortcutMap,
} from '../shared/shortcuts';
import type { ShortcutRegistrationError, ShortcutStatus } from '../shared/state';

/** The part of Electron's `globalShortcut` that is used. */
export interface ShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  isRegistered(accelerator: string): boolean;
  setSuspended?(suspended: boolean): void;
}

export type SetShortcutResult =
  | { ok: true; accelerator: string }
  | { ok: false; error: 'invalid'; reason: AcceleratorError }
  | { ok: false; error: 'duplicate'; conflictsWith: ShortcutAction }
  | { ok: false; error: 'in_use'; restoredPrevious: boolean };

interface Entry {
  accelerator: string;
  registered: boolean;
  error: ShortcutRegistrationError | null;
}

export class ShortcutManager {
  private readonly entries = new Map<ShortcutAction, Entry>();
  private suspended = false;

  constructor(
    private readonly registrar: ShortcutRegistrar,
    private readonly platform: DesktopPlatform,
    private readonly handlers: Record<ShortcutAction, () => void>,
  ) {}

  /** (Re)registers everything from the given map. Earlier actions win a duplicate. */
  apply(shortcuts: ShortcutMap): ShortcutStatus[] {
    this.unregisterAll();
    const taken = new Set<string>();
    for (const action of SHORTCUT_ACTIONS) {
      const parsed = parseAccelerator(shortcuts[action], this.platform);
      if (!parsed.ok) {
        this.entries.set(action, {
          accelerator: String(shortcuts[action] ?? ''),
          registered: false,
          error: 'invalid',
        });
        continue;
      }
      if (taken.has(parsed.accelerator)) {
        this.entries.set(action, {
          accelerator: parsed.accelerator,
          registered: false,
          error: 'duplicate',
        });
        continue;
      }
      taken.add(parsed.accelerator);
      this.entries.set(action, this.tryRegister(action, parsed.accelerator));
    }
    return this.status();
  }

  /** Changes one shortcut; on failure the previous registration is restored. */
  set(action: ShortcutAction, accelerator: string): SetShortcutResult {
    const parsed = parseAccelerator(accelerator, this.platform);
    if (!parsed.ok) return { ok: false, error: 'invalid', reason: parsed.error };

    const previous = this.entries.get(action) ?? null;
    if (previous?.accelerator === parsed.accelerator && previous.registered) {
      return { ok: true, accelerator: parsed.accelerator };
    }
    for (const other of SHORTCUT_ACTIONS) {
      if (other !== action && this.entries.get(other)?.accelerator === parsed.accelerator) {
        return { ok: false, error: 'duplicate', conflictsWith: other };
      }
    }

    if (previous?.registered) this.safeUnregister(previous.accelerator);
    const next = this.tryRegister(action, parsed.accelerator);
    if (next.registered) {
      this.entries.set(action, next);
      return { ok: true, accelerator: parsed.accelerator };
    }

    // Roll back to what worked before.
    let restoredPrevious = false;
    if (previous) {
      const restored = previous.registered
        ? this.tryRegister(action, previous.accelerator)
        : previous;
      this.entries.set(action, restored);
      restoredPrevious = restored.registered;
    }
    return { ok: false, error: 'in_use', restoredPrevious };
  }

  /** Current map (what is configured, whether or not it registered). */
  current(): ShortcutMap {
    const defaults = defaultShortcuts(this.platform);
    const map = { ...defaults };
    for (const action of SHORTCUT_ACTIONS) {
      const entry = this.entries.get(action);
      if (entry) map[action] = entry.accelerator;
    }
    return map;
  }

  isRegistered(action: ShortcutAction): boolean {
    return !this.suspended && this.entries.get(action)?.registered === true;
  }

  status(): ShortcutStatus[] {
    const defaults = defaultShortcuts(this.platform);
    return SHORTCUT_ACTIONS.map((action) => {
      const entry = this.entries.get(action) ?? {
        accelerator: defaults[action],
        registered: false,
        error: null,
      };
      return {
        action,
        accelerator: entry.accelerator,
        keyCaps: acceleratorKeyCaps(entry.accelerator, this.platform),
        registered: entry.registered && !this.suspended,
        error: this.suspended && entry.registered ? 'suspended' : entry.error,
        isDefault: entry.accelerator === defaults[action],
      };
    });
  }

  /**
   * Pauses handling while the user records a new combination, so pressing the
   * current shortcut does not trigger it. Always paired with a timeout by the caller.
   */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    try {
      this.registrar.setSuspended?.(suspended);
    } catch {
      // If suspension is unsupported the callbacks below still ignore presses.
    }
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  unregisterAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.registered) this.safeUnregister(entry.accelerator);
    }
    this.entries.clear();
  }

  private tryRegister(action: ShortcutAction, accelerator: string): Entry {
    let accepted: boolean;
    try {
      accepted = this.registrar.register(accelerator, () => {
        if (this.suspended) return;
        this.handlers[action]();
      });
      // `register` can report success for a combination the OS then refuses.
      accepted = accepted && this.registrar.isRegistered(accelerator);
    } catch {
      accepted = false;
    }
    if (!accepted) this.safeUnregister(accelerator);
    return { accelerator, registered: accepted, error: accepted ? null : 'in_use' };
  }

  private safeUnregister(accelerator: string): void {
    try {
      this.registrar.unregister(accelerator);
    } catch {
      // Nothing to undo.
    }
  }
}
