# @realtimedocs/ui

Design tokens and accessible React controls shared by the RealtimeDocs web app, the editor and
the desktop panel. Plain CSS behind the `rd-` prefix, React 19, no component library underneath.

## Use

```tsx
import '@realtimedocs/ui/styles.css'; // once per app: fonts, tokens, component styles
import { Button, ThemeProvider, ToastProvider } from '@realtimedocs/ui';

createRoot(root).render(
  <ThemeProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </ThemeProvider>,
);
```

The package is consumed as TypeScript source by Vite; there is no build step. Icons are not
re-exported: import them from `lucide-react` and pass them without a size (the kit sizes them).
TypeScript needs a `*.css` module declaration in the importing app (`/// <reference types="vite/client" />`).

## Theme

Dark is the default. `ThemeProvider` saves the choice under `localStorage['rd.theme']` (override
with `storageKey`), sets `data-theme="dark" | "light"` on `<html>`, follows the OS for `"system"`,
and keeps working when storage is blocked. `defaultTheme` defaults to `"dark"`.

`data-theme` also works on any subtree. Popovers, menus and tooltips opened from inside such a
subtree take its theme; dialogs and toasts follow the page.

On a see-through surface (the floating panel) add the class `rd-translucent` to the panel
element: secondary text takes the primary text colour and hairlines get stronger, because the
backdrop eats contrast.

The stylesheet also sets a small base: `box-sizing: border-box`, the body font, colour and
background, themed scrollbars, and a `:focus-visible` ring on everything. These rules have zero
specificity (`:where`), so one rule of your own overrides them. Two places need that: a
transparent window sets `body { background: transparent }`, and a `contenteditable` editor root,
which always counts as focus-visible, should set its own `outline`.

## Tokens

Contract tokens, defined in `src/styles.css` and checked by `test/contrast.test.ts`:

`--rd-bg`, `--rd-surface-1..3`, `--rd-overlay`, `--rd-border`, `--rd-border-strong`, `--rd-text`,
`--rd-text-muted`, `--rd-text-faint`, `--rd-accent`, `--rd-accent-hover`, `--rd-accent-contrast`,
`--rd-accent-soft`, `--rd-danger`, `--rd-warning`, `--rd-success`, `--rd-info` (each with `-soft`),
`--rd-focus-ring` (a colour), `--rd-radius-sm|md|lg|full` (4, 6, 10, 999px), `--rd-space-1..8`
(4, 8, 12, 16, 20, 24, 32, 40px), `--rd-font-ui|doc|mono`, `--rd-text-xs..2xl` (11, 12, 13, 15, 18,
24px in rem), `--rd-leading-tight|normal`, `--rd-shadow-1..3`, `--rd-z-dropdown|modal|toast` (1000,
1100, 1200), `--rd-duration-fast|base` (120, 180ms), `--rd-ease`, `--rd-control-h-sm|md` (28, 32px).

Things to know:

- Borders, the `-soft` colours and `--rd-overlay` are translucent, so they adapt to the surface
  under them. Use them as backgrounds and borders, not as text colours.
- On touch screens (`pointer: coarse`) `--rd-control-h-sm|md` become 36 and 40px, checkboxes and
  switches grow, and inputs use 16px text so iOS does not zoom. Size your own rows with the
  tokens and they follow.
- Under `prefers-reduced-motion: reduce` the durations become 0 and all animation stops.
- Supporting tokens exist for the components (`--rd-control-border`, `--rd-control-bg`,
  `--rd-hover`, `--rd-active`, `--rd-button-bg*`, `--rd-accent-pressed`, `--rd-danger-solid*`,
  `--rd-danger-contrast`, `--rd-raised`, `--rd-tooltip-*`, `--rd-signal-*`, `--rd-scrollbar`).
  They are not part of the contract and may change.
- The pressed look of a `Button` weighs one class (`.rd-btn--secondary:where([aria-pressed='true'])`),
  so a class of your own on the button overrides it without `!important`.

## Components

Every component forwards `className`, `style`, `ref`, `data-*` and other native props to its root
element. The exception is the form controls (`TextField`, `TextArea`, `Select`, `Checkbox`,
`Switch`, `Slider`, `CopyField`): `className` and `style` go to the wrapper, everything else
(including `ref` and `data-testid`) goes to the native `<input>`, `<select>` or `<textarea>`.

| Export                                                                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `LinkButton`                                                                                      | `variant` `primary`/`secondary`(default)/`ghost`/`danger`, `size` `md`/`sm`, `iconLeft`, `iconRight`, `fullWidth`. `loading` keeps width and focus and ignores clicks. `type` defaults to `button`. `pressed` (or `aria-pressed`) makes a `Button` a toggle with a pressed look in every variant.                                                                                                                                                   |
| `IconButton`                                                                                                | `label` is the accessible name and the tooltip. Icon as `children` or `icon`. `pressed` makes it a toggle. `variant` `ghost`/`solid`/`danger`. `tooltip={false}` to hide the tooltip.                                                                                                                                                                                                                                                               |
| `Link`                                                                                                      | A text link, opt-in: bare `<a>` elements are never styled. `underline` `always` (default, for running text) or `hover` (for navigation lists), `tone` `accent`/`neutral`. Adds `rel="noopener noreferrer"` to `target="_blank"`. The same look as a class: `rd-link`, `rd-link--quiet`, `rd-link--neutral`, also on a `<button>` or a router's link.                                                                                                |
| `Tooltip`                                                                                                   | `content`, `side`. Wraps one child that forwards `ref` and event handlers. Opens on hover (450ms) and keyboard focus, closes on Escape, blur and click.                                                                                                                                                                                                                                                                                             |
| `Popover`                                                                                                   | Controlled: `open`, `onOpenChange`. `trigger` (an element, gets a click toggle and ARIA state) or `anchor` (a render prop receiving `{ ref, aria-* }`, an element, a ref, or a virtual rect for text selections; opening is then up to you). `placement`, `initialFocus`, `role`.                                                                                                                                                                   |
| `Menu`, `MenuItem`, `MenuSeparator`, `MenuLabel`, `DropdownMenu`                                            | `DropdownMenu` takes `trigger` and items. `MenuItem`: `icon`, `shortcut`, `danger`, `disabled`, `checked` (makes it a checkbox item), `onSelect` (or `onClick`), `closeOnSelect`. With `href` it renders an `<a>` and its props, handlers and `ref` are typed for the anchor (`MenuItemLinkProps`); without, a `<button>` (`MenuItemButtonProps`). A link item still closes the menu when its `onClick` prevents the default, so router links work. |
| `Dialog`                                                                                                    | `open`, `onOpenChange`, `title`, `description`, `footer`, `size` `sm`/`md`/`lg`, `dismissible`, `initialFocus`. Initial focus: `initialFocus` (a ref, or a function returning the element), else `[data-autofocus]`, else the first control in the body, else the first in the footer.                                                                                                                                                              |
| `ConfirmDialog`                                                                                             | `title`, `message`, `confirmLabel`, `danger`, `onConfirm`, `onCancel`, optional `open` (default true, so it can be rendered conditionally). Optional `children` are shown under the message (a list of what is affected); the message stays the announced description and focus stays on the buttons. An async `onConfirm` shows progress and blocks dismissal; a rejection is shown in the dialog. Close it yourself when the promise resolves.    |
| `Sheet`                                                                                                     | A modal panel attached to an edge: `open`, `onOpenChange`, `title`, `description`, `footer`, `side` `end`(default)/`start`/`bottom`, `size` `sm` 320/`md` 400/`lg` 560px, `dismissible`, `initialFocus`. Focus, Escape and scroll lock as in `Dialog`.                                                                                                                                                                                              |
| `TextField`, `TextArea`, `Select`, `Field`                                                                  | `label`, `hint`, `error` (also sets `aria-invalid`), `hideLabel`. `TextField`: `prefix`, `suffix`, `size`. `Select`: `options` or `<option>` children, `placeholder`, `onValueChange`. `Field` wraps a custom control: `{(control) => <MyControl {...control} />}`.                                                                                                                                                                                 |
| `Checkbox`, `Switch`, `Slider`, `SegmentedControl`                                                          | Native inputs underneath. `Checkbox`: `label`, `hint`, `indeterminate`, `onCheckedChange`. `Switch`: `checked`, `onCheckedChange`, `label`. `Slider`: `min`, `max`, `step`, `value`, `onValueChange`, `label`, `formatValue`. `SegmentedControl`: `options`, `value`, `onValueChange`, `ariaLabel`, `iconOnly`, `fullWidth`.                                                                                                                        |
| `Tabs`, `TabPanel`                                                                                          | `tabs`, `value`, `onValueChange`. Put `<TabPanel id="…">` elements inside `<Tabs>` and they are shown, hidden and labelled for you. Outside `Tabs`, a `TabPanel` renders unless `active={false}`.                                                                                                                                                                                                                                                   |
| `Badge`, `StatusDot`, `Kbd`                                                                                 | `tone` `neutral`/`accent`/`success`/`warning`/`danger`/`info`. `StatusDot`: `pulse`, `label`.                                                                                                                                                                                                                                                                                                                                                       |
| `Avatar`, `AvatarStack`                                                                                     | Initials on a colour derived from the name, or on `color` with readable text chosen automatically. `size` `xs`/`sm`/`md`/`lg` or px. Stack: `people`, `max`.                                                                                                                                                                                                                                                                                        |
| `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`, `Banner`                                                 | `EmptyState`/`ErrorState`: `title`, `description`, `action`, `headingLevel`, `compact`; `ErrorState` adds `code`. `Banner`: `tone`, `title`, `action`, `onDismiss`.                                                                                                                                                                                                                                                                                 |
| `ToastProvider`, `useToast`                                                                                 | `show({ title, description?, tone?, durationMs?, action?, id? })` returns the id; `dismiss(id)`. `action` is `{ label, onClick }` or an element. `durationMs: 0` keeps a toast until dismissed.                                                                                                                                                                                                                                                     |
| `CopyField`                                                                                                 | `value`, `label`, `masked` (dots until revealed; copying always copies the real value), `onCopied`. A click selects the whole value, as Tab does natively; focus set by a script (a dialog opening) selects nothing.                                                                                                                                                                                                                                |
| `Toolbar`, `ToolbarGroup`, `ToolbarSeparator`                                                               | One tab stop. Scrolls sideways inside itself with faded edges.                                                                                                                                                                                                                                                                                                                                                                                      |
| `Card`, `Divider`, `ScrollArea`, `VisuallyHidden`                                                           | Layout helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `useOverlayLayer`, `OverlayProvider`, `useFocusTrap`, `useOverlayFocus`, `useScrollLock`, `useOutsidePress` | The parts the kit's overlays are made of, for building your own. See the next section.                                                                                                                                                                                                                                                                                                                                                              |
| `cx`, `copyText`, `ThemeProvider`, `useTheme`                                                               | `copyText(text)` resolves to `true` or `false` and never throws. Call it directly in the click handler.                                                                                                                                                                                                                                                                                                                                             |

`useTheme()` and `useToast()` throw outside their provider.

## Your own overlay

For an overlay the kit does not ship (a panel that is docked on wide screens and a sheet on
narrow ones, a command palette), use the hooks the kit's own overlays are built from. An
overlay registered this way shares one layer stack with `Dialog`, `Sheet`, `Popover` and
`DropdownMenu`, so there is no need to inspect `event.defaultPrevented` to guess who handled a key.

```tsx
function SidePanel({ modal, onClose, children }: SidePanelProps) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const layer = useOverlayLayer(panel, {
    onEscape: (event) => {
      // Docked: react only while focus is inside. `false` passes the key to the layer below.
      if (!modal && !panel?.contains(event.target as Node)) return false;
      onClose();
    },
  });
  useFocusTrap(layer, { enabled: modal });
  useScrollLock(modal);
  useOverlayFocus(layer, { initialFocus: 'container' });

  return (
    <aside
      ref={setPanel}
      role={modal ? 'dialog' : 'complementary'}
      aria-modal={modal || undefined}
      aria-label="Sharing"
      tabIndex={-1}
    >
      <OverlayProvider layer={layer}>{children}</OverlayProvider>
    </aside>
  );
}
```

| Export                                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useOverlayLayer(element, { onEscape, enabled })`                | Registers the overlay and returns its layer: `element`, `contains(node)` (true for overlays opened from inside it, wherever they are portalled) and `isTopMost()`. Escape goes to the top-most layer only: one opened from inside another is above it, otherwise the most recently opened wins. A handled Escape is marked with `event.preventDefault()` for you; return `false` from `onEscape` to decline it, and it is offered to the layer below. Without `onEscape` the layer ignores Escape. |
| `OverlayProvider` (`layer`, `container?`)                        | Wrap the overlay's content in it. Kit overlays opened inside then belong to this one: above it for Escape, inside it for outside presses and the focus trap. `container` is where they are portalled; give it when your overlay sits at or above `--rd-z-dropdown` (1000), and use a fixed element that covers the viewport and is not transformed or clipped, such as the wrapper around backdrop and panel.                                                                                      |
| `useFocusTrap(layer, { enabled })`                               | Tab and Shift+Tab wrap inside the overlay while it is the top-most trap, and focus that ended up behind it is pulled back in. A dialog or sheet opened from inside takes the trap until it closes.                                                                                                                                                                                                                                                                                                 |
| `useOverlayFocus(layer, { initialFocus, returnFocus, enabled })` | Moves focus in on open and back on close, unless the user has already moved it elsewhere. `initialFocus`: `'first'` (default: `[data-autofocus]`, else the first control, else the overlay), `'container'`, `'none'`, a ref, or a function returning the element.                                                                                                                                                                                                                                  |
| `useScrollLock(enabled?)`                                        | Stops the page from scrolling. Counted together with the kit's dialogs and sheets.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `useOutsidePress(layer, onOutsidePress, { enabled, ignore })`    | Calls back for a pointer press outside the overlay and everything opened from it. `ignore` lists elements that are not outside, such as the button that toggles the overlay.                                                                                                                                                                                                                                                                                                                       |

Three rules. Pass the element from state (`ref={setPanel}`), not a ref object, so the hooks run
when it appears. Call the hooks in a component that is mounted while the overlay is open, or
switch them with `enabled`. Give the element `tabIndex={-1}`, a role and an accessible name.

Kit overlays call `event.preventDefault()` on the Escape they handle (a modal one also when it
refuses to close). `Sheet` is written with exactly these hooks; `src/Sheet.tsx` is the worked example.

## Keyboard and screen readers

| Where            | Keys                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dialog, Sheet    | Tab cycles inside. Escape, the close button and the backdrop close it unless `dismissible={false}`. Focus returns to where it was.  |
| Popover          | Escape, a press outside, and Tab past either end close it. Focus returns to the anchor. Nested overlays close innermost first.      |
| Menu             | Up/Down move (wrapping, skipping disabled items), Home/End jump, letters jump to a match, Enter/Space choose, Tab and Escape close. |
| Dropdown trigger | Enter, Space or Down open on the first item, Up on the last. A mouse click opens without highlighting an item.                      |
| Toolbar          | Left/Right move, Home/End jump. Text inputs and sliders inside keep the arrow keys and their own tab stop. A select keeps Up/Down.  |
| Tabs             | Left/Right move and select (`activation="manual"` to select with Enter/Space), Home/End jump. The panel is focusable.               |
| SegmentedControl | A radio group: arrows move and select. Inside a toolbar the arrows only move and Enter/Space select.                                |
| Tooltip          | Escape hides it. It is the description of its child, except on `IconButton`, where it repeats the name and is not announced twice.  |
| Toasts           | Announced through a polite live region that is always in the DOM. They never take focus and pause while hovered or focused.         |

Labels, hints and errors are wired with `useId`. Focus rings are 2px in `--rd-focus-ring`.

## Contrast

WCAG 2.x ratios, computed from the token values. Translucent tokens are composited over the
surface first. `test/contrast.test.ts` fails if any text pair drops below 4.5:1 or any control
outline, focus ring, dot or icon below 3:1.

| Text token        | Dark: bg / s1 / s2 / s3   | Light: bg / s1 / s2 / s3  |
| ----------------- | ------------------------- | ------------------------- |
| `--rd-text`       | 16.2 / 15.1 / 13.8 / 12.0 | 15.8 / 17.2 / 15.1 / 13.8 |
| `--rd-text-muted` | 9.5 / 8.9 / 8.1 / 7.1     | 7.7 / 8.4 / 7.4 / 6.7     |
| `--rd-text-faint` | 6.9 / 6.4 / 5.9 / 5.1     | 5.7 / 6.2 / 5.5 / 5.0     |
| `--rd-accent`     | 10.2 / 9.5 / 8.7 / 7.6    | 6.2 / 6.7 / 5.9 / 5.4     |
| `--rd-success`    | 10.8 / 10.1 / 9.2 / 8.1   | 6.1 / 6.6 / 5.8 / 5.3     |
| `--rd-warning`    | 11.1 / 10.4 / 9.5 / 8.3   | 6.5 / 7.0 / 6.2 / 5.6     |
| `--rd-danger`     | 8.3 / 7.7 / 7.1 / 6.2     | 6.6 / 7.2 / 6.3 / 5.8     |
| `--rd-info`       | 9.2 / 8.6 / 7.9 / 6.9     | 6.6 / 7.1 / 6.3 / 5.7     |

| Pairing (lowest value over the four surfaces)                                        | Dark             | Light            |
| ------------------------------------------------------------------------------------ | ---------------- | ---------------- |
| Accent / success / warning / danger / info on own `-soft`                            | 4.8              | 4.8              |
| `--rd-text` on any `-soft` background                                                | 8.6              | 11.8             |
| Primary button: `--rd-accent-contrast` on `--rd-accent`                              | 9.6              | 6.7              |
| Danger button label on its fill, at rest / hover                                     | 5.3 / 4.8        | 7.2 / 9.6        |
| Pressed toggle, filled: label on `--rd-accent-pressed` / `--rd-danger-solid-pressed` | 5.6 / 8.5        | 13.2 / 13.3      |
| Link (`--rd-accent`) on a surface / on any `-soft` tint                              | 7.6 / 5.4        | 5.4 / 4.6        |
| Link on hover (`--rd-accent-hover`) on a surface / on any `-soft` tint               | 9.5 / 6.8        | 7.0 / 6.0        |
| Tooltip                                                                              | 16.2             | 15.8             |
| Menu, popover, toast: text / muted / faint                                           | 13.8 / 8.1 / 5.9 | 17.2 / 8.4 / 6.2 |
| Placeholder (`--rd-text-faint`) in an input                                          | 5.8              | 6.2              |
| Input, checkbox and switch outline (needs 3:1)                                       | 3.3              | 3.4              |
| Focus ring (needs 3:1)                                                               | 9.5              | 5.4              |
| Status dots and message icons (needs 3:1, bg to s2)                                  | 5.4              | 3.0              |

Not covered by these numbers: text on a translucent panel depends on what is behind it (use
`rd-translucent` and keep the panel alpha high), and `Avatar` colours passed in by the caller are
only matched with dark or light initials, whichever contrasts more.

## Fonts

- UI and document text: Atkinson Hyperlegible Next (variable, 200 to 800, roman and italic).
- Code, keys and share links: Atkinson Hyperlegible Mono (variable).

Both are SIL Open Font License 1.1, self-hosted through `@fontsource-variable/*` (latin and
latin-ext subsets, about 170 kB in total, loaded on demand). The family keeps look-alike
characters apart (I, l, 1 and O, 0), which is the point for share links and for text read in a
small panel over other windows. Devanagari and emoji come from system fonts listed in the
stacks: Noto Sans Devanagari, Nirmala UI, Kohinoor Devanagari, then the platform emoji font.

## Develop

```sh
. scripts/dev-env.sh                               # from the repository root
pnpm --filter @realtimedocs/ui run typecheck
pnpm exec vitest run --project ui                  # or: pnpm --filter @realtimedocs/ui run test
pnpm exec eslint packages/ui && pnpm exec prettier --check packages/ui
pnpm --filter @realtimedocs/ui run demo            # kitchen sink on http://127.0.0.1:5391
```

Screenshots and browser checks (overflow at 320 to 1280px, focus handling, the accessibility
tree, both clipboard paths, theme persistence, reduced motion, scripted clicks on switches and
checkboxes, toggle buttons, links, the sheet) run in the Playwright image while the demo is up:

```sh
docker run --rm --network host --user 1000:1000 -e HOME=/tmp \
  -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
  node packages/ui/demo/screenshot.mjs
```

Output goes to `demo/screenshots/`; the script exits non-zero when it finds a problem.
`-e ONLY=pages,overlays,focus,measure,a11y,behaviour,additions` limits the run to the named passes.

## Added after the first contract

Everything in the first contract is unchanged. Added since, at the request of the apps:

- Components: `Sheet`, `Link`.
- Overlay parts: `useOverlayLayer`, `OverlayProvider`, `useFocusTrap`, `useOverlayFocus`,
  `useScrollLock`, `useOutsidePress`.
- Props: `Button` `pressed`; `ConfirmDialog` `children`; `Dialog` `initialFocus` also takes a function.
- Types: `SheetProps`, `SheetSide`, `SheetSize`, `LinkProps`, `MenuItemButtonProps`,
  `MenuItemLinkProps` (`MenuItemProps` is now their union), `FocusTarget`, `OverlayLayer`,
  `OverlayLayerOptions`, `OverlayProviderProps`, `FocusTrapOptions`, `OverlayFocusOptions`,
  `OverlayFocusTarget`, `OutsidePressOptions`.
- Classes: `rd-link`, `rd-link--quiet`, `rd-link--neutral`. A pressed style for
  `.rd-btn[aria-pressed='true']`.

## Known limits

- Overlays have enter animations only; they close at once.
- A dialog or sheet traps Tab but does not make the page behind it `inert`. `aria-modal` and the
  backdrop cover screen readers and pointers; a test that queries by role still finds what is
  behind, so scope such queries to the dialog.
- While a dialog is open, toast buttons are outside its Tab cycle. They remain clickable.
- A `Link` with `underline="hover"` is told apart from the text around it by colour alone until it
  is hovered or focused. Keep it out of running text.
- `Menu` has no submenus. `Select` is the native control, so its open list looks like the platform.
- `VisuallyHidden` needs a positioned ancestor (`position: relative`) when it sits inside a scroll
  container, or it can widen the page. Kit components take care of this themselves.
- Checked in Chromium (Playwright, including the `execCommand` clipboard fallback) and in
  happy-dom unit tests. Not yet checked in Safari, Firefox, Electron on Windows or macOS, or with
  a screen reader.
