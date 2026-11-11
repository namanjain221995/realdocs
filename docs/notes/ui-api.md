# `@realtimedocs/ui` public API (contract)

`packages/ui` is built by the UI agent and may still be in progress when you start. Its export
names are fixed by this contract; check `packages/ui/src/index.ts` for the final prop types and
`packages/ui/README.md` for notes. Do not edit `packages/ui`; report defects.

Import styles once per app: `import '@realtimedocs/ui/styles.css'`. Theme: `data-theme="dark" | "light"`
on the root element (dark is the default). Class prefix `rd-`. Icons: import from `lucide-react` yourself.

Design tokens (CSS custom properties) you may use in your own CSS:
`--rd-bg, --rd-surface-1, --rd-surface-2, --rd-surface-3, --rd-overlay, --rd-border, --rd-border-strong,
--rd-text, --rd-text-muted, --rd-text-faint, --rd-accent, --rd-accent-hover, --rd-accent-contrast,
--rd-accent-soft, --rd-danger, --rd-danger-soft, --rd-warning, --rd-warning-soft, --rd-success,
--rd-success-soft, --rd-info, --rd-info-soft, --rd-focus-ring, --rd-radius-sm, --rd-radius-md,
--rd-radius-lg, --rd-radius-full, --rd-space-1 … --rd-space-8 (4, 8, 12, 16, 20, 24, 32, 40px),
--rd-font-ui, --rd-font-doc, --rd-font-mono, --rd-text-xs, --rd-text-sm, --rd-text-md, --rd-text-lg,
--rd-text-xl, --rd-text-2xl, --rd-leading-tight, --rd-leading-normal, --rd-shadow-1, --rd-shadow-2,
--rd-shadow-3, --rd-z-dropdown, --rd-z-modal, --rd-z-toast, --rd-duration-fast, --rd-duration-base,
--rd-ease, --rd-control-h-sm (28px), --rd-control-h-md (32px)`.

Exports (all forward `className`, `style`, `data-testid` and native props):

- Utilities: `cx(...parts)`, `copyText(text): Promise<boolean>` (Clipboard API with `execCommand` fallback).
- Theme: `ThemeProvider`, `useTheme()` → `{ theme: 'dark'|'light'|'system', resolved, setTheme }`.
- Buttons: `Button` (`variant: 'primary'|'secondary'|'ghost'|'danger'`, `size: 'sm'|'md'`, `loading`,
  `iconLeft`, `iconRight`, `fullWidth`), `IconButton` (required `label`, `pressed?`, `size`,
  `variant: 'ghost'|'solid'|'danger'`), `LinkButton`.
- Overlays: `Tooltip` (`content`, `side?`), `Popover` (`open`, `onOpenChange`, `trigger`/`anchor`,
  `placement?`), `Menu`, `MenuItem` (`icon?`, `shortcut?`, `danger?`, `disabled?`, `checked?`),
  `MenuSeparator`, `MenuLabel`, `DropdownMenu` (`trigger`, `children`), `Dialog` (`open`,
  `onOpenChange`, `title`, `description?`, `footer?`, `size?`, `dismissible?`), `ConfirmDialog`
  (`title`, `message`, `confirmLabel`, `danger?`, `onConfirm` (may be async), `onCancel`).
- Forms: `TextField` (`label`, `hint?`, `error?`, `prefix?`, `suffix?`), `TextArea`, `Select`
  (`options` or children), `Checkbox`, `Switch` (`checked`, `onCheckedChange`, `label?`), `Slider`
  (`min`, `max`, `step`, `value`, `onValueChange`, `label?`, `formatValue?`), `SegmentedControl`
  (`options`, `value`, `onValueChange`, `ariaLabel`), `Field`, `CopyField` (`value`, `label?`,
  `masked?`, `onCopied?`).
- Navigation: `Tabs` (`tabs`, `value`, `onValueChange`), `TabPanel`, `Toolbar`, `ToolbarGroup`,
  `ToolbarSeparator` (horizontal, scrolls inside itself, roving tabindex).
- Display: `Badge` (`tone`), `StatusDot` (`tone`, `pulse?`, `label?`), `Kbd`, `Avatar`, `AvatarStack`
  (`people`, `max?`), `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`, `Banner` (`tone`, `title?`,
  `action?`, `onDismiss?`), `Card`, `Divider`, `ScrollArea`, `VisuallyHidden`.
- Toasts: `ToastProvider`, `useToast()` → `{ show({ title, description?, tone?, durationMs?, action? }), dismiss(id) }`.

## Added after the first contract (2026-11-11)

Additive; see `packages/ui/README.md` ("Added after the first contract", "Your own overlay").

- Components: `Sheet` (`side: 'end'|'start'|'bottom'`, `size`, otherwise the `Dialog` props), `Link`
  (also the classes `rd-link`, `rd-link--quiet`, `rd-link--neutral`; there is no global `a` rule).
- Overlay building blocks for custom overlays that join the kit's layer stack (Escape closes only
  the top layer, focus trap, focus return, scroll lock): `useOverlayLayer(element, { onEscape, enabled })`,
  `OverlayProvider`, `useFocusTrap`, `useOverlayFocus`, `useScrollLock`, `useOutsidePress`.
- New props: `Button` `pressed` (styles `aria-pressed="true"`), `ConfirmDialog` `children`,
  `Dialog` `initialFocus` (ref or function returning an element).
- `MenuItemProps` is now a union discriminated by `href` (`MenuItemButtonProps` | `MenuItemLinkProps`);
  do not `extend` it with an interface.
- `CopyField` no longer selects its text on programmatic focus (a click or Tab still selects it).
- Testing note: a dialog or sheet does not make the page behind it `inert`; scope role queries to
  the dialog.
