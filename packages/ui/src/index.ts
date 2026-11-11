// Public API of @realtimedocs/ui. Import the stylesheet once per app:
//   import '@realtimedocs/ui/styles.css';

export { cx, copyText } from './utils';
export type { ClassValue } from './utils';

export { ThemeProvider, useTheme } from './theme';
export type { ResolvedTheme, Theme, ThemeContextValue, ThemeProviderProps } from './theme';

export { Button, IconButton, LinkButton } from './Button';
export { Link } from './Link';
export type { LinkProps } from './Link';
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  IconButtonProps,
  IconButtonVariant,
  LinkButtonProps,
} from './Button';

export { Tooltip } from './Tooltip';
export type { TooltipProps, TooltipSide } from './Tooltip';

export { Popover } from './Popover';
export type {
  PopoverAnchor,
  PopoverAnchorProps,
  PopoverInitialFocus,
  PopoverPlacement,
  PopoverProps,
  PopoverVirtualAnchor,
} from './Popover';

export { DropdownMenu, Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';
export type {
  DropdownMenuProps,
  MenuInitialFocus,
  MenuItemButtonProps,
  MenuItemLinkProps,
  MenuItemProps,
  MenuProps,
} from './Menu';

export { ConfirmDialog, Dialog } from './Dialog';
export type { ConfirmDialogProps, DialogProps, DialogSize } from './Dialog';

export { Sheet } from './Sheet';
export type { SheetProps, SheetSide, SheetSize } from './Sheet';

// Building blocks for overlays the kit does not ship. See README, "Your own overlay".
export {
  OverlayProvider,
  useFocusTrap,
  useOutsidePress,
  useOverlayFocus,
  useOverlayLayer,
  useScrollLock,
} from './overlay';
export type {
  FocusTrapOptions,
  OutsidePressOptions,
  OverlayFocusOptions,
  OverlayFocusTarget,
  OverlayLayer,
  OverlayLayerOptions,
  OverlayProviderProps,
} from './overlay';
export type { FocusTarget } from './internal/focus';

export { Field, Select, TextArea, TextField } from './Field';
export type {
  ControlSize,
  FieldControlProps,
  FieldProps,
  SelectOption,
  SelectProps,
  TextAreaProps,
  TextFieldProps,
} from './Field';

export { Checkbox, SegmentedControl, Slider, Switch } from './Choice';
export type {
  CheckboxProps,
  SegmentedControlProps,
  SegmentedOption,
  SliderProps,
  SwitchProps,
} from './Choice';

export { TabPanel, Tabs } from './Tabs';
export type { TabItem, TabPanelProps, TabsProps } from './Tabs';

export { Badge, Banner, EmptyState, ErrorState, Skeleton, StatusDot } from './Feedback';
export type {
  BadgeProps,
  BannerProps,
  EmptyStateProps,
  ErrorStateProps,
  SkeletonProps,
  StatusDotProps,
  Tone,
} from './Feedback';

export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerSize } from './Spinner';

export { Avatar, AvatarStack } from './Avatar';
export type { AvatarPerson, AvatarProps, AvatarSize, AvatarStackProps } from './Avatar';

export { ToastProvider, useToast } from './Toast';
export type { ToastAction, ToastApi, ToastOptions, ToastProviderProps } from './Toast';

export { CopyField } from './CopyField';
export type { CopyFieldProps } from './CopyField';

export { Toolbar, ToolbarGroup, ToolbarSeparator } from './Toolbar';
export type { ToolbarProps } from './Toolbar';

export { Card, Divider, Kbd, ScrollArea, VisuallyHidden } from './Primitives';
export type { CardProps, DividerProps, ScrollAreaProps } from './Primitives';
