/** Turns the plain menu model into an Electron `Menu`. Shared by the tray and the macOS app menu. */
import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuActionId, MenuEntry } from '../menu-model';

export interface MenuBuildOptions {
  run: (action: MenuActionId) => void;
  /**
   * Whether accelerators should also be registered as key equivalents. The
   * tray menu only displays them (the real shortcuts are global shortcuts).
   */
  registerAccelerators: boolean;
}

function toTemplate(entry: MenuEntry, options: MenuBuildOptions): MenuItemConstructorOptions {
  if (entry.type === 'separator') return { type: 'separator' };
  if (entry.type === 'submenu') {
    return {
      label: entry.label ?? '',
      submenu: (entry.submenu ?? []).map((child) => toTemplate(child, options)),
    };
  }
  if (entry.type === 'info') return { label: entry.label ?? '', enabled: false };

  const template: MenuItemConstructorOptions = {
    type: entry.type === 'checkbox' ? 'checkbox' : entry.type === 'radio' ? 'radio' : 'normal',
    enabled: entry.enabled ?? true,
  };
  if (entry.label) template.label = entry.label;
  if (entry.type === 'checkbox' || entry.type === 'radio')
    template.checked = entry.checked ?? false;
  // A display-only accelerator in a Linux tray menu makes GTK complain (that
  // menu has no accelerator group); Linux is a test platform only, so it is left out there.
  if (entry.accelerator && (options.registerAccelerators || process.platform !== 'linux')) {
    template.accelerator = entry.accelerator;
    if (!options.registerAccelerators) template.registerAccelerator = false;
  }
  if (entry.role) {
    // Native roles carry their own behaviour and platform shortcuts.
    template.role = entry.role;
  } else if (entry.action) {
    const action = entry.action;
    template.click = () => options.run(action);
  }
  return template;
}

export function buildMenu(entries: readonly MenuEntry[], options: MenuBuildOptions): Menu {
  return Menu.buildFromTemplate(entries.map((entry) => toTemplate(entry, options)));
}
