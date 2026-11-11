/**
 * The editing toolbar: one compact row built from the UI kit's `Toolbar`
 * (a single tab stop with arrow-key navigation that scrolls inside itself).
 *
 * It renders from `useToolbarState`, a narrow snapshot that changes when the
 * formatting at the selection changes, not on every keystroke.
 */
import {
  DropdownMenu,
  IconButton,
  Kbd,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  Select,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '@realtimedocs/ui';
import type { Editor } from '@tiptap/core';
import {
  Baseline,
  Bold,
  Code,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Redo2,
  Search,
  SquareCode,
  Strikethrough,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  TextQuote,
  Underline,
  Undo2,
  UnfoldVertical,
  Workflow,
} from 'lucide-react';
import { memo, useRef, useState, type ReactNode } from 'react';
import { CALLOUT_VARIANTS, FONT_SIZES, LINE_HEIGHTS, type LineHeight } from '../schema';
import { CALLOUT_LABELS, insertCallout, removeCallout, setCalloutVariant } from './calloutCommands';
import { formatShortcut } from './platform';
import { useToolbarState } from './toolbarState';

/** Readable on the light and the dark document surface alike. */
export const TEXT_COLORS: { value: string; label: string }[] = [
  { value: '#e03131', label: 'Red' },
  { value: '#e8590c', label: 'Orange' },
  { value: '#b8860b', label: 'Amber' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#0c8599', label: 'Teal' },
  { value: '#1c7ed6', label: 'Blue' },
  { value: '#7048e8', label: 'Violet' },
  { value: '#c2255c', label: 'Pink' },
  { value: '#868e96', label: 'Grey' },
];

export const HIGHLIGHT_COLORS: { value: string; label: string }[] = [
  { value: '#fde68a', label: 'Yellow' },
  { value: '#bbf7d0', label: 'Green' },
  { value: '#bae6fd', label: 'Blue' },
  { value: '#fbcfe8', label: 'Pink' },
  { value: '#fed7aa', label: 'Orange' },
  { value: '#ddd6fe', label: 'Violet' },
  { value: '#e5e7eb', label: 'Grey' },
];

const BLOCK_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading1', label: 'Heading 1' },
  { value: 'heading2', label: 'Heading 2' },
  { value: 'heading3', label: 'Heading 3' },
  { value: 'heading4', label: 'Heading 4' },
];

const SIZE_OPTIONS = [
  { value: '', label: 'Size' },
  ...FONT_SIZES.map((size) => ({ value: size, label: size.replace('px', '') })),
];

const SPACING_LABELS: Record<LineHeight, string> = {
  '1': 'Single',
  '1.15': '1.15',
  '1.5': '1.5',
  '2': 'Double',
};

interface ToolButtonProps {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
}

function ToolButton({
  label,
  shortcut,
  icon,
  pressed,
  disabled,
  onClick,
  testId,
}: ToolButtonProps) {
  return (
    <IconButton
      size="sm"
      label={label}
      icon={icon}
      pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      tooltip={
        shortcut ? (
          <>
            {label} <Kbd>{formatShortcut(shortcut)}</Kbd>
          </>
        ) : undefined
      }
      // Keep the document selection (and the soft keyboard) while pressing.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    />
  );
}

interface SwatchPopoverProps {
  label: string;
  icon: ReactNode;
  current: string;
  colors: { value: string; label: string }[];
  clearLabel: string;
  onPick: (color: string | null) => void;
}

function SwatchPopover({ label, icon, current, colors, clearLabel, onPick }: SwatchPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      aria-label={label}
      trigger={
        <IconButton
          size="sm"
          label={label}
          pressed={current !== ''}
          icon={
            <span className="rd-swatch-icon" style={current ? { color: current } : undefined}>
              {icon}
            </span>
          }
        />
      }
    >
      <div className="rd-swatches" role="group" aria-label={label}>
        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            className="rd-swatch"
            style={{ backgroundColor: color.value }}
            aria-label={color.label}
            aria-pressed={current.toLowerCase() === color.value}
            title={color.label}
            onClick={() => {
              onPick(color.value);
              setOpen(false);
            }}
          />
        ))}
        <button
          type="button"
          className="rd-swatch rd-swatch--clear"
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
        >
          {clearLabel}
        </button>
      </div>
    </Popover>
  );
}

export interface EditorToolbarProps {
  editor: Editor;
  /** Opens the find bar. */
  onFind: () => void;
  /** Opens the link editor for the current selection. */
  onLink: () => void;
  /** Accepted by the file pickers (from the server limits). */
  imageAccept: string;
  attachmentAccept: string;
}

function EditorToolbarInner({
  editor,
  onFind,
  onLink,
  imageAccept,
  attachmentAccept,
}: EditorToolbarProps) {
  const state = useToolbarState(editor);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = () => editor.chain().focus();

  const pickFiles = (input: HTMLInputElement): void => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) editor.chain().focus().insertFiles(files).run();
  };

  return (
    <Toolbar className="rd-editor-toolbar" aria-label="Formatting" data-testid="rd-toolbar">
      <ToolbarGroup aria-label="History">
        <ToolButton
          label="Undo"
          shortcut="Mod+Z"
          icon={<Undo2 size={16} />}
          disabled={!state.canUndo}
          onClick={() => run().undo().run()}
          testId="rd-tool-undo"
        />
        <ToolButton
          label="Redo"
          shortcut="Mod+Shift+Z"
          icon={<Redo2 size={16} />}
          disabled={!state.canRedo}
          onClick={() => run().redo().run()}
          testId="rd-tool-redo"
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Text style">
        <Select
          size="sm"
          aria-label="Block type"
          className="rd-editor-toolbar__block"
          data-testid="rd-tool-block"
          value={state.block === 'other' ? '' : state.block}
          placeholder="Block"
          options={BLOCK_OPTIONS}
          onValueChange={(value) => {
            if (value === 'paragraph') run().setParagraph().run();
            else {
              const level = Number(value.replace('heading', '')) as 1 | 2 | 3 | 4;
              run().setHeading({ level }).run();
            }
          }}
        />
        <Select
          size="sm"
          aria-label="Font size"
          className="rd-editor-toolbar__size"
          data-testid="rd-tool-size"
          value={FONT_SIZES.includes(state.fontSize) ? state.fontSize : ''}
          options={SIZE_OPTIONS}
          onValueChange={(value) => {
            if (value) run().setFontSize(value).run();
            else run().unsetFontSize().run();
          }}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Emphasis">
        <ToolButton
          label="Bold"
          shortcut="Mod+B"
          icon={<Bold size={16} />}
          pressed={state.bold}
          onClick={() => run().toggleBold().run()}
          testId="rd-tool-bold"
        />
        <ToolButton
          label="Italic"
          shortcut="Mod+I"
          icon={<Italic size={16} />}
          pressed={state.italic}
          onClick={() => run().toggleItalic().run()}
          testId="rd-tool-italic"
        />
        <ToolButton
          label="Underline"
          shortcut="Mod+U"
          icon={<Underline size={16} />}
          pressed={state.underline}
          onClick={() => run().toggleUnderline().run()}
          testId="rd-tool-underline"
        />
        <ToolButton
          label="Strikethrough"
          shortcut="Mod+Shift+S"
          icon={<Strikethrough size={16} />}
          pressed={state.strike}
          onClick={() => run().toggleStrike().run()}
          testId="rd-tool-strike"
        />
        <ToolButton
          label="Inline code"
          shortcut="Mod+E"
          icon={<Code size={16} />}
          pressed={state.code}
          onClick={() => run().toggleCode().run()}
        />
        <SwatchPopover
          label="Text colour"
          icon={<Baseline size={16} />}
          current={state.color}
          colors={TEXT_COLORS}
          clearLabel="Default colour"
          onPick={(color) => {
            if (color) run().setColor(color).run();
            else run().unsetColor().run();
          }}
        />
        <SwatchPopover
          label="Highlight"
          icon={<Highlighter size={16} />}
          current={state.highlight === 'default' ? '#fde68a' : state.highlight}
          colors={HIGHLIGHT_COLORS}
          clearLabel="No highlight"
          onPick={(color) => {
            if (color) run().setHighlight({ color }).run();
            else run().unsetHighlight().run();
          }}
        />
        <ToolButton
          label="Link"
          shortcut="Mod+K"
          icon={<Link2 size={16} />}
          pressed={state.link}
          onClick={onLink}
          testId="rd-tool-link"
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Paragraph">
        <ToolButton
          label="Align left"
          shortcut="Mod+Shift+L"
          icon={<TextAlignStart size={16} />}
          pressed={state.align === 'left'}
          onClick={() => run().setTextAlign('left').run()}
        />
        <ToolButton
          label="Align centre"
          shortcut="Mod+Shift+E"
          icon={<TextAlignCenter size={16} />}
          pressed={state.align === 'center'}
          onClick={() => run().setTextAlign('center').run()}
          testId="rd-tool-align-center"
        />
        <ToolButton
          label="Align right"
          shortcut="Mod+Shift+R"
          icon={<TextAlignEnd size={16} />}
          pressed={state.align === 'right'}
          onClick={() => run().setTextAlign('right').run()}
        />
        <ToolButton
          label="Justify"
          shortcut="Mod+Shift+J"
          icon={<TextAlignJustify size={16} />}
          pressed={state.align === 'justify'}
          onClick={() => run().setTextAlign('justify').run()}
        />
        <ToolButton
          label="Decrease indent"
          shortcut="Shift+Tab"
          icon={<IndentDecrease size={16} />}
          disabled={
            state.indent === 0 && !state.bulletList && !state.orderedList && !state.taskList
          }
          onClick={() => {
            if (state.taskList) run().liftListItem('taskItem').run();
            else if (state.bulletList || state.orderedList) run().liftListItem('listItem').run();
            else run().outdent().run();
          }}
          testId="rd-tool-outdent"
        />
        <ToolButton
          label="Increase indent"
          shortcut="Tab"
          icon={<IndentIncrease size={16} />}
          onClick={() => {
            if (state.taskList) run().sinkListItem('taskItem').run();
            else if (state.bulletList || state.orderedList) run().sinkListItem('listItem').run();
            else run().indent().run();
          }}
          testId="rd-tool-indent"
        />
        <DropdownMenu
          aria-label="Line spacing"
          trigger={
            <IconButton
              size="sm"
              label="Line spacing"
              icon={<UnfoldVertical size={16} />}
              pressed={state.lineHeight !== ''}
              data-testid="rd-tool-spacing"
            />
          }
        >
          <MenuLabel>Line spacing</MenuLabel>
          <MenuItem
            checked={state.lineHeight === ''}
            onSelect={() => run().setLineHeight(null).run()}
          >
            Default
          </MenuItem>
          {LINE_HEIGHTS.map((value) => (
            <MenuItem
              key={value}
              checked={state.lineHeight === value}
              onSelect={() => run().setLineHeight(value).run()}
            >
              {SPACING_LABELS[value]}
            </MenuItem>
          ))}
        </DropdownMenu>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Lists and blocks">
        <ToolButton
          label="Bulleted list"
          shortcut="Mod+Shift+8"
          icon={<List size={16} />}
          pressed={state.bulletList}
          onClick={() => run().toggleBulletList().run()}
          testId="rd-tool-bullets"
        />
        <ToolButton
          label="Numbered list"
          shortcut="Mod+Shift+7"
          icon={<ListOrdered size={16} />}
          pressed={state.orderedList}
          onClick={() => run().toggleOrderedList().run()}
        />
        <ToolButton
          label="Checklist"
          shortcut="Mod+Shift+9"
          icon={<ListChecks size={16} />}
          pressed={state.taskList}
          onClick={() => run().toggleTaskList().run()}
        />
        <ToolButton
          label="Quote"
          shortcut="Mod+Shift+B"
          icon={<TextQuote size={16} />}
          pressed={state.blockquote}
          onClick={() => run().toggleBlockquote().run()}
        />
        <ToolButton
          label="Code block"
          shortcut="Mod+Alt+C"
          icon={<SquareCode size={16} />}
          pressed={state.codeBlock}
          onClick={() => run().toggleCodeBlock().run()}
          testId="rd-tool-codeblock"
        />
        <DropdownMenu
          aria-label="Callout"
          trigger={
            <IconButton
              size="sm"
              label="Callout"
              icon={<Info size={16} />}
              pressed={state.callout !== ''}
              disabled={state.callout === '' && !state.canCallout}
              data-testid="rd-tool-callout"
              data-callout={state.callout || undefined}
            />
          }
        >
          <MenuLabel>{state.callout ? 'Callout type' : 'Insert callout'}</MenuLabel>
          {CALLOUT_VARIANTS.map((variant) => (
            <MenuItem
              key={variant}
              checked={state.callout === variant}
              data-testid={`rd-callout-${variant}`}
              onSelect={() => {
                if (state.callout) setCalloutVariant(editor, variant);
                else insertCallout(editor, variant);
              }}
            >
              {CALLOUT_LABELS[variant]}
            </MenuItem>
          ))}
          {state.callout ? (
            <>
              <MenuSeparator />
              <MenuItem
                danger
                data-testid="rd-callout-remove"
                onSelect={() => removeCallout(editor)}
              >
                Remove callout
              </MenuItem>
            </>
          ) : null}
        </DropdownMenu>
        <ToolButton
          label="Separator"
          icon={<Minus size={16} />}
          onClick={() => run().setHorizontalRule().run()}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Insert">
        <DropdownMenu
          aria-label="Table"
          trigger={
            <IconButton
              size="sm"
              label="Table"
              icon={<Table size={16} />}
              pressed={state.inTable}
              data-testid="rd-tool-table"
            />
          }
        >
          <MenuItem
            onSelect={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          >
            Insert table
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!state.inTable} onSelect={() => run().addRowBefore().run()}>
            Insert row above
          </MenuItem>
          <MenuItem disabled={!state.inTable} onSelect={() => run().addRowAfter().run()}>
            Insert row below
          </MenuItem>
          <MenuItem disabled={!state.inTable} onSelect={() => run().addColumnBefore().run()}>
            Insert column left
          </MenuItem>
          <MenuItem disabled={!state.inTable} onSelect={() => run().addColumnAfter().run()}>
            Insert column right
          </MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!state.inTable} onSelect={() => run().toggleHeaderRow().run()}>
            Toggle header row
          </MenuItem>
          <MenuItem disabled={!state.inTable} onSelect={() => run().toggleHeaderColumn().run()}>
            Toggle header column
          </MenuItem>
          <MenuItem disabled={!state.inTable} onSelect={() => run().mergeOrSplit().run()}>
            Merge or split cells
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger disabled={!state.inTable} onSelect={() => run().deleteRow().run()}>
            Delete row
          </MenuItem>
          <MenuItem danger disabled={!state.inTable} onSelect={() => run().deleteColumn().run()}>
            Delete column
          </MenuItem>
          <MenuItem danger disabled={!state.inTable} onSelect={() => run().deleteTable().run()}>
            Delete table
          </MenuItem>
        </DropdownMenu>
        <ToolButton
          label="Image"
          icon={<ImagePlus size={16} />}
          onClick={() => imageInput.current?.click()}
          testId="rd-tool-image"
        />
        <ToolButton
          label="Attachment"
          icon={<Paperclip size={16} />}
          onClick={() => fileInput.current?.click()}
          testId="rd-tool-attachment"
        />
        <ToolButton
          label="Mermaid diagram"
          icon={<Workflow size={16} />}
          onClick={() => run().insertDiagram().run()}
          testId="rd-tool-diagram"
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="Search">
        <ToolButton
          label="Find and replace"
          shortcut="Mod+F"
          icon={<Search size={16} />}
          onClick={onFind}
          testId="rd-tool-find"
        />
      </ToolbarGroup>
      <input
        ref={imageInput}
        type="file"
        hidden
        multiple
        tabIndex={-1}
        accept={imageAccept}
        data-testid="rd-image-input"
        aria-label="Choose images to upload"
        onChange={(event) => pickFiles(event.currentTarget)}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        tabIndex={-1}
        accept={attachmentAccept}
        data-testid="rd-attachment-input"
        aria-label="Choose files to attach"
        onChange={(event) => pickFiles(event.currentTarget)}
      />
    </Toolbar>
  );
}

export const EditorToolbar = memo(EditorToolbarInner);
