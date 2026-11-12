import {
  Avatar,
  DropdownMenu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  type Theme,
  useTheme,
} from '@realtimedocs/ui';
import {
  CalendarClock,
  ChevronDown,
  FileText,
  KeyRound,
  LogOut,
  PackageOpen,
  Settings,
  UsersRound,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useMediaQuery } from '../lib/hooks';
import { workspaceRoleLabel } from '../lib/permissions';
import { useSession } from '../lib/session';
import { Brand } from './Brand';
import { useRouterLink } from './links';
import { useSignOut } from './SignOut';
import { THEME_OPTIONS } from './ThemeControl';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** `end` keeps "/" from matching every path. */
  end?: boolean;
}

function navItems(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [{ to: '/', label: 'Documents', icon: <FileText />, end: true }];
  if (isAdmin) {
    items.push({ to: '/admin/users', label: 'People', icon: <UsersRound /> });
    items.push({ to: '/admin/releases', label: 'Releases', icon: <PackageOpen /> });
    items.push({ to: '/admin/interview-sessions', label: 'Interviews', icon: <CalendarClock /> });
    items.push({ to: '/admin/api-keys', label: 'API keys', icon: <KeyRound /> });
    items.push({ to: '/admin/webhooks', label: 'Webhooks', icon: <Webhook /> });
  }
  return items;
}

function MenuNavItem({ item }: { item: NavItem }) {
  const link = useRouterLink(item.to);
  return (
    <MenuItem href={link.href} onClick={link.onClick} icon={item.icon}>
      {item.label}
    </MenuItem>
  );
}

function UserMenu({ items, showNav }: { items: NavItem[]; showNav: boolean }) {
  const { user } = useSession();
  const { theme, setTheme } = useTheme();
  const { requestSignOut } = useSignOut();
  const settings = useRouterLink('/settings');
  if (!user) return null;
  return (
    <DropdownMenu
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className="app-user-button"
          aria-label={`Account menu for ${user.displayName}`}
        >
          <Avatar name={user.displayName} size="sm" aria-hidden="true" />
          <span className="app-user-button__name">{user.displayName}</span>
          <ChevronDown className="app-user-button__chevron" aria-hidden="true" />
        </button>
      }
    >
      <div className="app-user-menu__identity" role="presentation">
        <span className="app-user-menu__name">{user.displayName}</span>
        <span className="app-user-menu__email">{user.email}</span>
        <span className="app-user-menu__role">{workspaceRoleLabel(user.role)}</span>
      </div>
      <MenuSeparator />
      {showNav ? (
        <>
          {items.map((item) => (
            <MenuNavItem key={item.to} item={item} />
          ))}
        </>
      ) : null}
      <MenuItem href={settings.href} onClick={settings.onClick} icon={<Settings />}>
        Settings
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>Theme</MenuLabel>
      {THEME_OPTIONS.map((option) => (
        <MenuItem
          key={option.value}
          checked={theme === option.value}
          closeOnSelect={false}
          onSelect={() => setTheme(option.value satisfies Theme)}
        >
          {option.label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<LogOut />} onSelect={requestSignOut}>
        Sign out
      </MenuItem>
    </DropdownMenu>
  );
}

/** Frame of the signed-in app: wordmark, navigation, account menu, page content. */
export function AppShell({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  const phone = useMediaQuery('(max-width: 639px)');
  const tablet = useMediaQuery('(max-width: 1023px)');
  const items = navItems(isAdmin);
  // An administrator has six destinations: they fit beside the wordmark and the
  // account button on a laptop, not on a tablet. Below that they live in the
  // account menu, as all of them do on a phone.
  const narrow = phone || (items.length > 2 && tablet);
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Brand />
        {narrow ? null : (
          <nav className="app-nav" aria-label="Main">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="app-nav__link">
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="app-topbar__end">
          <UserMenu items={items} showNav={narrow} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="app-main">
        {children}
      </main>
    </div>
  );
}
