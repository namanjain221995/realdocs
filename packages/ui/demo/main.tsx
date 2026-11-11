import {
  Archive,
  Bold,
  Code,
  CopyPlus,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Globe,
  Highlighter,
  History,
  Image,
  Inbox,
  Italic,
  KeyRound,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minimize2,
  Monitor,
  Moon,
  MousePointer2,
  Pencil,
  Pin,
  Plus,
  Quote,
  Redo2,
  Search,
  Share2,
  Strikethrough,
  Sun,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Trash,
  Underline,
  Undo2,
  Users,
} from 'lucide-react';
import { type ReactNode, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Avatar,
  AvatarStack,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CopyField,
  Dialog,
  Divider,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Kbd,
  Link,
  LinkButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Slider,
  Spinner,
  StatusDot,
  Switch,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  type Theme,
  ThemeProvider,
  ToastProvider,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  Tooltip,
  useTheme,
  useToast,
  VisuallyHidden,
} from '../src/index';
import '../src/styles.css';
import './demo.css';

const PEOPLE = [
  { id: 'u1', name: 'Asha Rao', title: 'Asha Rao is editing' },
  { id: 'u2', name: 'Marcus Lindqvist' },
  { id: 'u3', name: 'प्रिया शर्मा', title: 'प्रिया शर्मा is viewing' },
  { id: 'u4', name: 'Tomás Oliveira' },
  { id: 'u5', name: 'Wen Li' },
  { id: 'u6', name: 'Noor Haddad' },
];

const SHARE_LINK = 'https://docs.example.test/s/8Kq2vL0OIl1x#Zt4mB9wQ7nR3';

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="demo-section" aria-labelledby={`${id}-title`} data-section={id}>
      <div className="demo-section__intro">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{note}</p>
      </div>
      <div className="demo-section__body">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="demo-row">
      {label ? <div className="demo-row__label">{label}</div> : null}
      <div className="demo-row__items">{children}</div>
    </div>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl<Theme>
      ariaLabel="Theme"
      size="sm"
      value={theme}
      onValueChange={setTheme}
      data-testid="theme-switch"
      options={[
        { value: 'dark', label: 'Dark', icon: <Moon /> },
        { value: 'light', label: 'Light', icon: <Sun /> },
        { value: 'system', label: 'System', icon: <Monitor /> },
      ]}
    />
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="demo-swatch">
      <span className="demo-swatch__chip" style={{ background: `var(${token})` }} />
      <span className="demo-swatch__label">{label}</span>
      <code className="demo-swatch__token">{token}</code>
    </div>
  );
}

function Foundations() {
  return (
    <Section
      id="foundations"
      title="Ink, paper and one accent"
      note="Dark is ink with paper-coloured text; light is paper with the same ink. Mint marks the main action, selection and focus. Green, amber and red only ever describe document state."
    >
      <div className="demo-swatches">
        <Swatch token="--rd-bg" label="Background" />
        <Swatch token="--rd-surface-1" label="Surface 1" />
        <Swatch token="--rd-surface-2" label="Surface 2" />
        <Swatch token="--rd-surface-3" label="Surface 3" />
        <Swatch token="--rd-text" label="Text" />
        <Swatch token="--rd-text-muted" label="Muted" />
        <Swatch token="--rd-text-faint" label="Faint" />
        <Swatch token="--rd-accent" label="Accent" />
        <Swatch token="--rd-success" label="Live, saved" />
        <Swatch token="--rd-warning" label="Reconnecting" />
        <Swatch token="--rd-danger" label="Offline, revoked" />
        <Swatch token="--rd-info" label="Info" />
      </div>
      <div className="demo-type">
        <p className="demo-type__2xl">Quarterly planning notes</p>
        <p className="demo-type__xl">Decisions from the March review</p>
        <p className="demo-type__doc">
          Shipping moves to the 14th. टीम ने नई समय-सीमा पर सहमति दी 🎉 and Asha will update the
          roadmap before Friday. <em>Budget is unchanged</em>, with one open question on hosting.
        </p>
        <p className="demo-type__meta">Edited 2 minutes ago by Asha Rao</p>
        <code className="demo-type__mono">{SHARE_LINK}</code>
      </div>
    </Section>
  );
}

function Actions() {
  const [saving, setSaving] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [panel, setPanel] = useState<'share' | 'snapshots' | null>('share');
  const [source, setSource] = useState(true);
  const [following, setFollowing] = useState(true);
  const [paused, setPaused] = useState(true);
  const [details, setDetails] = useState(false);
  return (
    <Section
      id="actions"
      title="Buttons"
      note="Controls are 32px tall, or 28px in tight rows. One primary action per view."
    >
      <Row label="Variants">
        <Button variant="primary" iconLeft={<Plus />}>
          New document
        </Button>
        <Button iconLeft={<Share2 />}>Share</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger" iconLeft={<Trash />}>
          Delete forever
        </Button>
      </Row>
      <Row label="Small">
        <Button size="sm" variant="primary">
          Create link
        </Button>
        <Button size="sm" iconRight={<ExternalLink />}>
          Open in desktop
        </Button>
        <Button size="sm" variant="ghost">
          Dismiss
        </Button>
        <Button size="sm" variant="danger">
          Revoke
        </Button>
      </Row>
      <Row label="States">
        <Button
          variant="primary"
          loading={saving}
          data-testid="save-button"
          onClick={() => {
            setSaving(true);
            setTimeout(() => setSaving(false), 1600);
          }}
        >
          Save snapshot
        </Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button loading>Restoring</Button>
        <Button disabled>Restore</Button>
        <LinkButton href="#overlays" iconRight={<ExternalLink />}>
          Print view
        </LinkButton>
      </Row>
      <Row label="Icon buttons">
        <IconButton label="Search documents">
          <Search />
        </IconButton>
        <IconButton label="Keep on top" pressed={pinned} onClick={() => setPinned(!pinned)}>
          <Pin />
        </IconButton>
        <IconButton label="More actions" variant="solid">
          <Ellipsis />
        </IconButton>
        <IconButton label="Move to trash" variant="danger">
          <Trash />
        </IconButton>
        <IconButton label="Collapse panel" size="sm">
          <Minimize2 />
        </IconButton>
        <IconButton label="Search documents" size="sm" variant="solid" disabled>
          <Search />
        </IconButton>
        <span className="demo-inline">
          Find <Kbd>Ctrl</Kbd>
          <Kbd>F</Kbd>
        </span>
      </Row>
      <Row label="Toggles">
        <Button
          iconLeft={<Share2 />}
          pressed={panel === 'share'}
          onClick={() => setPanel(panel === 'share' ? null : 'share')}
          data-testid="toggle-share"
        >
          Share
        </Button>
        <Button
          iconLeft={<History />}
          pressed={panel === 'snapshots'}
          onClick={() => setPanel(panel === 'snapshots' ? null : 'snapshots')}
          data-testid="toggle-snapshots"
        >
          Snapshots
        </Button>
        <Button
          variant="ghost"
          pressed={source}
          onClick={() => setSource(!source)}
          data-testid="toggle-source"
        >
          Show source
        </Button>
        <Button
          variant="primary"
          pressed={following}
          onClick={() => setFollowing(!following)}
          data-testid="toggle-follow"
        >
          Follow latest
        </Button>
        <Button
          variant="danger"
          pressed={paused}
          onClick={() => setPaused(!paused)}
          data-testid="toggle-pause"
        >
          Pause sharing
        </Button>
      </Row>
      <Row label="Links">
        <p className="demo-prose">
          Screen-share hiding depends on the meeting app.{' '}
          <Link href="#panel" data-testid="link-inline">
            Check what others see
          </Link>{' '}
          before you rely on it, or read the{' '}
          <Link href="https://www.electronjs.org/docs/latest/api/browser-window" target="_blank">
            Electron notes
          </Link>
          .
        </p>
        <Link href="#foundations" underline="hover" data-testid="link-quiet">
          All documents
        </Link>
        <Link href="#foundations" tone="neutral">
          Privacy
        </Link>
        <button
          type="button"
          className="rd-link"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          {details ? 'Hide details' : 'Show details'}
        </button>
      </Row>
      <Row label="Full width">
        <div className="demo-narrow">
          <Button variant="primary" fullWidth>
            Open document
          </Button>
        </div>
      </Row>
    </Section>
  );
}

type Alignment = 'start' | 'center' | 'end' | 'justify';

function EditorToolbar() {
  const [marks, setMarks] = useState<Record<string, boolean>>({ bold: true });
  const [alignment, setAlignment] = useState<Alignment>('start');
  const [block, setBlock] = useState('paragraph');
  const toggle = (mark: string) => () =>
    setMarks((current) => ({ ...current, [mark]: !current[mark] }));
  return (
    <Toolbar aria-label="Formatting" className="demo-toolbar" data-testid="editor-toolbar">
      <ToolbarGroup aria-label="History">
        <IconButton label="Undo" size="sm">
          <Undo2 />
        </IconButton>
        <IconButton label="Redo" size="sm" disabled>
          <Redo2 />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <Select
        aria-label="Text style"
        size="sm"
        value={block}
        onValueChange={setBlock}
        className="demo-toolbar__select"
        options={[
          { value: 'paragraph', label: 'Paragraph' },
          { value: 'h1', label: 'Heading 1' },
          { value: 'h2', label: 'Heading 2' },
          { value: 'h3', label: 'Heading 3' },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Text formatting">
        <IconButton label="Bold" size="sm" pressed={marks.bold === true} onClick={toggle('bold')}>
          <Bold />
        </IconButton>
        <IconButton
          label="Italic"
          size="sm"
          pressed={marks.italic === true}
          onClick={toggle('italic')}
        >
          <Italic />
        </IconButton>
        <IconButton
          label="Underline"
          size="sm"
          pressed={marks.underline === true}
          onClick={toggle('underline')}
        >
          <Underline />
        </IconButton>
        <IconButton
          label="Strikethrough"
          size="sm"
          pressed={marks.strike === true}
          onClick={toggle('strike')}
        >
          <Strikethrough />
        </IconButton>
        <IconButton
          label="Highlight"
          size="sm"
          pressed={marks.highlight === true}
          onClick={toggle('highlight')}
        >
          <Highlighter />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <SegmentedControl<Alignment>
        ariaLabel="Alignment"
        size="sm"
        iconOnly
        value={alignment}
        onValueChange={setAlignment}
        options={[
          { value: 'start', label: 'Align left', icon: <TextAlignStart /> },
          { value: 'center', label: 'Align centre', icon: <TextAlignCenter /> },
          { value: 'end', label: 'Align right', icon: <TextAlignEnd /> },
          { value: 'justify', label: 'Justify', icon: <TextAlignJustify /> },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Lists">
        <IconButton label="Bulleted list" size="sm">
          <List />
        </IconButton>
        <IconButton label="Numbered list" size="sm">
          <ListOrdered />
        </IconButton>
        <IconButton label="Checklist" size="sm">
          <ListChecks />
        </IconButton>
        <IconButton label="Quote" size="sm">
          <Quote />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Insert">
        <IconButton label="Link" size="sm">
          <Link2 />
        </IconButton>
        <IconButton label="Image" size="sm">
          <Image />
        </IconButton>
        <IconButton label="Table" size="sm">
          <Table />
        </IconButton>
        <IconButton label="Code block" size="sm">
          <Code />
        </IconButton>
      </ToolbarGroup>
      <ToolbarSeparator />
      <DropdownMenu
        trigger={
          <IconButton label="More formatting" size="sm">
            <Ellipsis />
          </IconButton>
        }
      >
        <MenuItem shortcut="Ctrl+\">Clear formatting</MenuItem>
        <MenuItem>Insert divider</MenuItem>
      </DropdownMenu>
    </Toolbar>
  );
}

function ToolbarSection() {
  return (
    <Section
      id="toolbar"
      title="Toolbar"
      note="One tab stop; the arrow keys move between controls. When it runs out of room it scrolls inside itself and fades at the edges, so the page never grows sideways."
    >
      <Card padding="none" className="demo-editor">
        <EditorToolbar />
        <Divider />
        <div className="demo-editor__page">
          <p>
            Shipping moves to the 14th. Asha will update the roadmap before Friday, and the budget
            is unchanged.
          </p>
        </div>
      </Card>
      <div className="demo-squeeze">
        <EditorToolbar />
      </div>
    </Section>
  );
}

function Fields() {
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [expiry, setExpiry] = useState('7d');
  const [opacity, setOpacity] = useState(72);
  const [fontSize, setFontSize] = useState(15);
  const [follow, setFollow] = useState(true);
  const [clickThrough, setClickThrough] = useState(false);
  const [title, setTitle] = useState('Quarterly planning notes');
  return (
    <Section
      id="fields"
      title="Fields"
      note="Labels sit above their controls. Hints and errors are tied to the control, so a screen reader reads them with it."
    >
      <div className="demo-grid">
        <TextField
          label="Document title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          data-testid="title-field"
        />
        <TextField
          label="Search"
          placeholder="Find a document"
          prefix={<Search />}
          suffix={<Kbd>/</Kbd>}
        />
        <TextField
          label="Invite by email"
          type="email"
          defaultValue="marcus@example"
          error="Enter a full address, like marcus@example.com."
        />
        <TextField
          label="Server address"
          defaultValue="docs.example.test"
          prefix="https://"
          hint="The address of your RealtimeDocs server, not localhost."
        />
        <Select
          label="Link expires"
          value={expiry}
          onValueChange={setExpiry}
          options={[
            { value: '1d', label: 'In 1 day' },
            { value: '7d', label: 'In 7 days' },
            { value: '30d', label: 'In 30 days' },
            { value: 'never', label: 'Never' },
          ]}
          hint="Expired links stop working for everyone."
        />
        <Field label="Access" hint="View-only people cannot change the document.">
          {(control) => (
            <SegmentedControl
              {...control}
              ariaLabel="Access"
              fullWidth
              value={role}
              onValueChange={setRole}
              options={[
                { value: 'view', label: 'Can view' },
                { value: 'edit', label: 'Can edit' },
              ]}
            />
          )}
        </Field>
        <TextArea
          label="Snapshot note"
          placeholder="What changed since the last snapshot?"
          rows={3}
          className="demo-grid__wide"
        />
        <TextField label="Workspace" defaultValue="Northwind Studio" disabled />
        <Select label="Role" disabled defaultValue="admin">
          <option value="admin">Administrator</option>
        </Select>
      </div>
      <div className="demo-grid">
        <div className="demo-stack">
          <Checkbox
            label="Notify me when someone opens the link"
            defaultChecked
            data-testid="notify-checkbox"
          />
          <Checkbox
            label="Include images in exports"
            hint="Markdown exports link to images instead."
          />
          <Checkbox label="Select all documents" indeterminate />
          <Checkbox label="Allow downloads" disabled defaultChecked />
        </div>
        <div className="demo-stack">
          <Switch
            label="Follow latest edits"
            hint="Pauses while you scroll back or select text."
            checked={follow}
            onCheckedChange={setFollow}
            data-testid="follow-switch"
          />
          <Switch
            label="Click-through reading mode"
            checked={clickThrough}
            onCheckedChange={setClickThrough}
            data-testid="click-through-switch"
          />
          <Switch label="Keep on top" checked disabled onCheckedChange={() => undefined} />
        </div>
        <Slider
          label="Panel background"
          min={20}
          max={100}
          value={opacity}
          onValueChange={setOpacity}
          formatValue={(value) => `${value}%`}
          data-testid="opacity-slider"
        />
        <Slider
          label="Text size"
          min={12}
          max={24}
          step={1}
          value={fontSize}
          onValueChange={setFontSize}
          formatValue={(value) => `${value}px`}
        />
        <CopyField label="Share link" value={SHARE_LINK} data-testid="share-link" />
        <CopyField
          label="Invitation link"
          value="https://docs.example.test/invite/5fR1#Xy7Kp2Lm"
          masked
          hint="Anyone with this link can create an account."
        />
      </div>
    </Section>
  );
}

type AccessTab = 'people' | 'links' | 'history';

function Navigation() {
  const [tab, setTab] = useState<AccessTab>('people');
  return (
    <Section
      id="tabs"
      title="Tabs"
      note="Left and Right switch tabs. Each panel is labelled by its tab."
    >
      <Card padding="none">
        <Tabs<AccessTab>
          className="demo-tabs"
          ariaLabel="Sharing"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { id: 'people', label: 'People', icon: <Users />, badge: 4 },
            { id: 'links', label: 'Share links', icon: <Link2 />, badge: 2 },
            { id: 'history', label: 'Snapshots', icon: <History /> },
          ]}
        >
          <TabPanel id="people" className="demo-tabs__panel">
            <ul className="demo-people">
              {PEOPLE.slice(0, 4).map((person, index) => (
                <li key={person.id}>
                  <Avatar name={person.name} size="md" />
                  <span className="demo-people__name">{person.name}</span>
                  <Badge tone={index === 0 ? 'accent' : 'neutral'}>
                    {index === 0 ? 'Administrator' : index < 3 ? 'Editor' : 'Viewer'}
                  </Badge>
                </li>
              ))}
            </ul>
          </TabPanel>
          <TabPanel id="links" className="demo-tabs__panel">
            <ul className="demo-people">
              <li>
                <Globe className="demo-people__icon" />
                <span className="demo-people__name">Review link</span>
                <Badge tone="success">Active</Badge>
              </li>
              <li>
                <KeyRound className="demo-people__icon" />
                <span className="demo-people__name">Agency link</span>
                <Badge tone="danger">Revoked</Badge>
              </li>
            </ul>
          </TabPanel>
          <TabPanel id="history" className="demo-tabs__panel">
            <EmptyState
              compact
              icon={<History />}
              title="No snapshots yet"
              description="Save a snapshot to keep a named version you can return to."
              action={<Button size="sm">Save snapshot</Button>}
            />
          </TabPanel>
        </Tabs>
      </Card>
    </Section>
  );
}

function Status() {
  return (
    <Section
      id="status"
      title="Status and people"
      note="State is always written out next to its colour. A pulsing dot means something is happening right now."
    >
      <Row label="Connection">
        <StatusDot tone="success" pulse label="Live" />
        <StatusDot tone="success" label="Saved" />
        <StatusDot tone="warning" pulse label="Reconnecting" />
        <StatusDot tone="danger" label="Offline" />
        <StatusDot tone="danger" label="Access revoked" />
        <StatusDot label="Connecting" />
        <StatusDot tone="info" label="3 changes pending" />
      </Row>
      <Row label="Badges">
        <Badge>Viewer</Badge>
        <Badge tone="accent">Editor</Badge>
        <Badge tone="success">Active</Badge>
        <Badge tone="warning">Expires today</Badge>
        <Badge tone="danger">Revoked</Badge>
        <Badge tone="info" icon={<Globe />}>
          Anyone with the link
        </Badge>
      </Row>
      <Row label="People">
        <Avatar name="Asha Rao" size="xs" />
        <Avatar name="Marcus Lindqvist" />
        <Avatar name="प्रिया शर्मा" size="md" />
        <Avatar name="Tomás Oliveira" size="lg" />
        <Avatar name="Wen Li" color="#ff6b3d" size="lg" />
        <Avatar name="Noor Haddad" color="#1d3b8f" size="lg" />
        <AvatarStack people={PEOPLE.slice(0, 3)} />
        <AvatarStack people={PEOPLE} max={4} size="md" />
      </Row>
      <Row label="Loading">
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
        <div className="demo-skeleton">
          <Skeleton circle width={28} height={28} />
          <Skeleton lines={3} />
        </div>
      </Row>
    </Section>
  );
}

function Messages() {
  const [dismissed, setDismissed] = useState(false);
  return (
    <Section
      id="messages"
      title="Messages"
      note="A banner stays in the page until the situation changes. Errors say what happened and what to do next."
    >
      <div className="demo-stack">
        <Banner tone="warning" title="Reconnecting">
          Your last 3 changes are kept on this device and will sync when the connection returns.
        </Banner>
        <Banner
          tone="danger"
          title="Changes are not being saved"
          action={
            <Button size="sm" variant="secondary">
              Try again
            </Button>
          }
        >
          The server could not store your edits. Keep this tab open.
        </Banner>
        <Banner tone="success">Restored the snapshot from 12 March.</Banner>
        {dismissed ? null : (
          <Banner tone="info" onDismiss={() => setDismissed(true)}>
            You are viewing this document. Ask an administrator for edit access.
          </Banner>
        )}
        <Banner tone="neutral" title="Screen-share hiding is not guaranteed on macOS">
          Check what the other participants see before you rely on it.
        </Banner>
      </div>
      <div className="demo-grid">
        <Card padding="none">
          <EmptyState
            icon={<Inbox />}
            title="No documents yet"
            description="Create a document, then share a link so others can follow along as you type."
            action={
              <Button variant="primary" iconLeft={<Plus />}>
                New document
              </Button>
            }
          />
        </Card>
        <Card padding="none">
          <ErrorState
            title="This link was revoked"
            description="The person who shared it turned it off. Ask them for a new link."
            code="LINK_REVOKED"
            action={<Button>Paste another link</Button>}
          />
        </Card>
      </div>
    </Section>
  );
}

const HIGHLIGHTS = ['#f8bd40', '#60db89', '#79bbf3', '#ff8987', '#c4a8f2'];

function Overlays() {
  const toast = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [highlight, setHighlight] = useState(HIGHLIGHTS[0]);
  const [wrap, setWrap] = useState(true);
  const [access, setAccess] = useState<'view' | 'edit'>('view');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [linkReadyOpen, setLinkReadyOpen] = useState(false);
  return (
    <Section
      id="overlays"
      title="Overlays"
      note="Dialogs trap focus and give it back. Menus and popovers close on Escape, on a press outside, and when Tab leaves them. Toasts never take focus."
    >
      <Row label="Dialog">
        <Button onClick={() => setShareOpen(true)} iconLeft={<Share2 />} data-testid="open-dialog">
          Share
        </Button>
        <Button variant="danger" onClick={() => setConfirmOpen(true)} data-testid="open-confirm">
          Revoke link
        </Button>
        <Button onClick={() => setTrashOpen(true)} data-testid="open-confirm-list">
          Move 3 to trash
        </Button>
        <Button onClick={() => setLinkReadyOpen(true)} data-testid="open-link-ready">
          Show new link
        </Button>
      </Row>
      <Row label="Sheet">
        <Button iconLeft={<History />} onClick={() => setSheetOpen(true)} data-testid="open-sheet">
          Snapshots
        </Button>
      </Row>
      <Row label="Menu and popover">
        <DropdownMenu
          trigger={
            <Button iconRight={<Ellipsis />} data-testid="open-menu">
              Document
            </Button>
          }
        >
          <MenuItem icon={<Pencil />} shortcut="F2">
            Rename
          </MenuItem>
          <MenuItem icon={<CopyPlus />} shortcut="Ctrl+D">
            Duplicate
          </MenuItem>
          <MenuItem icon={<Download />}>Export as Markdown</MenuItem>
          <MenuSeparator />
          <MenuLabel>View</MenuLabel>
          <MenuItem checked={wrap} onSelect={() => setWrap(!wrap)} closeOnSelect={false}>
            Wrap long lines
          </MenuItem>
          <MenuItem checked={false} disabled>
            Show comments
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Archive />}>Archive</MenuItem>
          <MenuItem icon={<Trash />} danger>
            Move to trash
          </MenuItem>
        </DropdownMenu>
        <Popover
          open={colorOpen}
          onOpenChange={setColorOpen}
          aria-label="Highlight colour"
          trigger={
            <Button iconLeft={<Highlighter />} data-testid="open-popover">
              Highlight
            </Button>
          }
        >
          <div className="demo-colors">
            {HIGHLIGHTS.map((color) => (
              <button
                key={color}
                type="button"
                className="demo-colors__chip"
                style={{ background: color }}
                aria-label={`Highlight ${color}`}
                aria-pressed={color === highlight}
                onClick={() => {
                  setHighlight(color);
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        </Popover>
        <Tooltip content="Follows the newest edit as it arrives" side="bottom">
          <Button variant="ghost" iconLeft={<MousePointer2 />} data-testid="tooltip-target">
            Follow latest
          </Button>
        </Tooltip>
      </Row>
      <Row label="Toast">
        <Button
          data-testid="toast-success"
          onClick={() => toast.show({ title: 'Link copied', tone: 'success' })}
        >
          Copy link
        </Button>
        <Button
          data-testid="toast-action"
          onClick={() =>
            toast.show({
              title: 'Moved to trash',
              description: 'Quarterly planning notes',
              action: {
                label: 'Undo',
                onClick: () => toast.show({ title: 'Restored', tone: 'success' }),
              },
            })
          }
        >
          Move to trash
        </Button>
        <Button
          data-testid="toast-danger"
          onClick={() =>
            toast.show({
              title: 'Upload failed',
              description: 'The image is larger than 10 MB.',
              tone: 'danger',
              durationMs: 0,
            })
          }
        >
          Upload image
        </Button>
      </Row>
      <Row label="Menu, inline">
        <Card padding="none" raised className="demo-menu-card">
          <Menu aria-label="Document actions">
            <MenuItem icon={<Pencil />} shortcut="F2">
              Rename
            </MenuItem>
            <MenuItem icon={<CopyPlus />} shortcut="Ctrl+D">
              Duplicate
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>View</MenuLabel>
            <MenuItem checked>Wrap long lines</MenuItem>
            <MenuItem checked={false}>Show word count</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash />} danger>
              Move to trash
            </MenuItem>
          </Menu>
        </Card>
      </Row>

      <Dialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Share “Quarterly planning notes”"
        description="Anyone with the link can open this document without an account."
        data-testid="share-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setShareOpen(false);
                toast.show({ title: 'Link created', tone: 'success' });
              }}
            >
              Create link
            </Button>
          </>
        }
      >
        <div className="demo-stack">
          <TextField label="Link name" defaultValue="Review link" />
          <Field label="Access">
            {(control) => (
              <SegmentedControl
                {...control}
                ariaLabel="Access"
                fullWidth
                value={access}
                onValueChange={setAccess}
                options={[
                  { value: 'view', label: 'Can view' },
                  { value: 'edit', label: 'Can edit' },
                ]}
              />
            )}
          </Field>
          <Select
            label="Link expires"
            defaultValue="7d"
            options={[
              { value: '1d', label: 'In 1 day' },
              { value: '7d', label: 'In 7 days' },
              { value: 'never', label: 'Never' },
            ]}
          />
          <CopyField label="Current link" value={SHARE_LINK} />
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Revoke this link?"
        message="People using it are disconnected right away. Content they already copied or downloaded stays with them."
        confirmLabel="Revoke link"
        danger
        data-testid="confirm-dialog"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await new Promise((resolve) => setTimeout(resolve, 900));
          setConfirmOpen(false);
          toast.show({ title: 'Link revoked', tone: 'success' });
        }}
      />

      <ConfirmDialog
        open={trashOpen}
        title="Move 3 documents to the trash?"
        message="You can restore them from the trash for 30 days."
        confirmLabel="Move to trash"
        danger
        data-testid="confirm-list"
        onCancel={() => setTrashOpen(false)}
        onConfirm={() => {
          setTrashOpen(false);
          toast.show({ title: 'Moved 3 documents to the trash' });
        }}
      >
        <ul className="demo-confirm-list">
          <li>Quarterly planning notes</li>
          <li>Roadmap 2027</li>
          <li>Hosting quotes</li>
        </ul>
      </ConfirmDialog>

      <Dialog
        open={linkReadyOpen}
        onOpenChange={setLinkReadyOpen}
        title="Link created"
        description="Copy it now. It is shown only this once."
        size="sm"
        data-testid="link-ready"
        footer={
          <Button variant="primary" onClick={() => setLinkReadyOpen(false)}>
            Done
          </Button>
        }
      >
        <CopyField label="Share link" value={SHARE_LINK} data-testid="link-ready-field" />
      </Dialog>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Snapshots"
        description="Named versions of this document. Restoring one saves the current version first."
        data-testid="snapshots-sheet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheetOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setSheetOpen(false);
                toast.show({ title: 'Snapshot saved', tone: 'success' });
              }}
            >
              Save snapshot
            </Button>
          </>
        }
      >
        <div className="demo-stack">
          <TextField
            label="Snapshot name"
            placeholder="Before the March review"
            data-testid="snapshot-name"
          />
          <ul className="demo-people">
            {['Before the March review', 'First draft', 'Imported outline'].map((name, index) => (
              <li key={name}>
                <History className="demo-people__icon" />
                <span className="demo-people__name">{name}</span>
                <DropdownMenu
                  placement="bottom-end"
                  trigger={
                    <IconButton
                      label={`Actions for ${name}`}
                      size="sm"
                      data-testid={index === 0 ? 'snapshot-menu' : undefined}
                    >
                      <Ellipsis />
                    </IconButton>
                  }
                >
                  <MenuItem>Restore</MenuItem>
                  <MenuItem>Rename</MenuItem>
                  <MenuSeparator />
                  <MenuItem danger>Delete</MenuItem>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
    </Section>
  );
}

function FloatingPanel() {
  const [alpha, setAlpha] = useState(70);
  const [pinned, setPinned] = useState(true);
  return (
    <Section
      id="panel"
      title="Floating panel"
      note="The same controls on a translucent surface over other windows. Borders, hover fills and the toolbar fade are alpha-based, so they hold up on any backdrop."
    >
      <div className="demo-desktop">
        <div
          className="demo-panel rd-translucent"
          style={{ background: `rgb(10 18 21 / ${alpha}%)` }}
          data-theme="dark"
          data-testid="floating-panel"
        >
          <header className="demo-panel__bar">
            <FileText className="demo-panel__doc-icon" />
            <span className="demo-panel__title">Quarterly planning notes</span>
            <StatusDot tone="success" pulse label="Live" />
            <AvatarStack people={PEOPLE.slice(0, 3)} size="xs" />
            <IconButton
              label="Keep on top"
              size="sm"
              pressed={pinned}
              onClick={() => setPinned(!pinned)}
            >
              <Pin />
            </IconButton>
            <IconButton label="Collapse panel" size="sm">
              <Minimize2 />
            </IconButton>
          </header>
          <ScrollArea
            className="demo-panel__doc"
            maxHeight={132}
            tabIndex={0}
            aria-label="Document"
          >
            <p>
              Shipping moves to the 14th. टीम ने नई समय-सीमा पर सहमति दी 🎉 and Asha will update the
              roadmap before Friday.
            </p>
            <p>
              Budget is unchanged, with one open question on hosting. Marcus is collecting quotes
              and will share them in this document by Wednesday.
            </p>
            <p>Next review: 28 March, 10:00.</p>
          </ScrollArea>
          <footer className="demo-panel__foot">
            <Slider
              aria-label="Panel background"
              hideValue
              min={20}
              max={100}
              value={alpha}
              onValueChange={setAlpha}
              className="demo-panel__slider"
            />
            <Badge tone="neutral">View only</Badge>
            <Button size="sm">Jump to latest</Button>
          </footer>
        </div>
      </div>
    </Section>
  );
}

function App() {
  return (
    <div className="demo">
      <header className="demo-header">
        <div className="demo-header__brand">
          <span className="demo-header__mark" aria-hidden="true" />
          <h1>
            RealtimeDocs <span>UI kit</span>
          </h1>
        </div>
        <div className="demo-header__tools">
          <StatusDot tone="success" pulse label="Live" />
          <ThemeSwitch />
        </div>
      </header>
      <main className="demo-main">
        <Foundations />
        <Actions />
        <ToolbarSection />
        <Fields />
        <Navigation />
        <Status />
        <Messages />
        <Overlays />
        <FloatingPanel />
      </main>
      <VisuallyHidden>End of the component overview.</VisuallyHidden>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
