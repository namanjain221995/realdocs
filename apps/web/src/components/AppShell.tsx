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
  LayoutPanelTop,
  LogOut,
  PackageOpen,
  Settings,
  UsersRound,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useMediaQuery } from '../lib/hooks';
import { DOCUMENTS_PATH, PRODUCT_PATH } from '../lib/navigation';
import { workspaceRoleLabel } from '../lib/permissions';
import { useSession } from '../lib/session';
import { Brand } from './Brand';
import { useRouterLink } from './links';
import { useSignOut } from './SignOut';
import { THEME_OPTIONS } from './ThemeControl';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** `end` keeps "/" from matching every path. */
  end?: boolean;
}

function navItems(isAdmin: boolean): NavItem[] {
  const items: NavItem[] = [
    { to: DOCUMENTS_PATH, label: 'Documents', icon: <FileText />, end: true },
  ];
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

/**
 * The account button and its menu. `items` are listed in the menu when `showNav` is set (they
 * are not visible elsewhere on a narrow screen, or on the product page).
 */
export function AccountMenu({
  items,
  showNav,
  productLink = true,
}: {
  items: NavItem[];
  showNav: boolean;
  /** Offer the product page. Off on the product page itself. */
  productLink?: boolean;
}) {
  const { user } = useSession();
  const product = useRouterLink(PRODUCT_PATH);
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
      {productLink ? (
        <MenuItem href={product.href} onClick={product.onClick} icon={<LayoutPanelTop />}>
          Product page
        </MenuItem>
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
        <Brand to={DOCUMENTS_PATH} />
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
          <AccountMenu items={items} showNav={narrow} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="app-main">
        {children}
      </main>
    </div>
  );
}
