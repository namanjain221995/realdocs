import { act, createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  AvatarStack,
  Badge,
  Banner,
  Button,
  Checkbox,
  CopyField,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Link,
  LinkButton,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Spinner,
  StatusDot,
  Switch,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
} from '../src/index';
import {
  byTestId,
  click,
  flush,
  focus,
  get,
  getAll,
  press,
  query,
  render,
  setValue,
} from './helpers';

function describedBy(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<missing ${id}>`)
    .join(' | ');
}

function labelFor(element: Element): string | undefined {
  return query(`label[for="${element.id}"]`)?.textContent ?? undefined;
}

describe('Button', () => {
  it('defaults to a non-submitting secondary button and forwards native props', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button
        ref={ref}
        data-testid="share"
        className="extra"
        style={{ marginTop: 4 }}
        title="Share"
      >
        Share
      </Button>,
    );
    const button = byTestId<HTMLButtonElement>('share');
    expect(ref.current).toBe(button);
    expect(button.type).toBe('button');
    expect(button.className).toBe('rd-btn rd-btn--secondary rd-btn--md extra');
    expect(button.style.marginTop).toBe('4px');
    expect(button.title).toBe('Share');
  });

  it('stays focusable but ignores clicks while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} data-testid="save">
        Save
      </Button>,
    );
    const button = byTestId<HTMLButtonElement>('save');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    // The label stays in the accessibility tree.
    expect(button.textContent).toBe('Save');
    click(button);
    expect(onClick).not.toHaveBeenCalled();
    focus(button);
    expect(document.activeElement).toBe(button);
  });

  it('does not submit a form while loading', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading data-testid="submit">
          Create
        </Button>
      </form>,
    );
    click(byTestId('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders icons on either side of the label', () => {
    render(
      <Button iconLeft={<svg data-testid="left" />} iconRight={<svg data-testid="right" />}>
        Open
      </Button>,
    );
    const parts = Array.from(get('.rd-btn').children).map((child) => child.className);
    expect(parts).toEqual(['rd-btn__icon', 'rd-btn__label', 'rd-btn__icon']);
  });
});

describe('Button as a toggle', () => {
  it('is not a toggle by default', () => {
    render(<Button data-testid="plain">Share</Button>);
    expect(byTestId('plain').hasAttribute('aria-pressed')).toBe(false);
  });

  it('reflects the pressed prop as aria-pressed, true and false', () => {
    const view = render(
      <Button pressed data-testid="toggle">
        Snapshots
      </Button>,
    );
    expect(byTestId('toggle').getAttribute('aria-pressed')).toBe('true');
    view.rerender(
      <Button pressed={false} data-testid="toggle">
        Snapshots
      </Button>,
    );
    expect(byTestId('toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('still accepts aria-pressed directly', () => {
    render(
      <Button aria-pressed data-testid="toggle" variant="ghost">
        Follow latest
      </Button>,
    );
    const button = byTestId('toggle');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // No extra class: the pressed look hangs off the attribute.
    expect(button.className).toBe('rd-btn rd-btn--ghost rd-btn--md');
  });
});

describe('Link', () => {
  it('is an opt-in styled anchor that forwards native props', () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Link href="/docs/help" ref={ref} className="extra" data-testid="link" title="Help">
        Read the guide
      </Link>,
    );
    const link = byTestId<HTMLAnchorElement>('link');
    expect(ref.current).toBe(link);
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/docs/help');
    expect(link.className).toBe('rd-link extra');
    expect(link.title).toBe('Help');
    expect(link.textContent).toBe('Read the guide');
    expect(link.hasAttribute('rel')).toBe(false);
  });

  it('has a quiet and a neutral variant', () => {
    render(
      <>
        <Link href="/a" underline="hover" data-testid="quiet">
          Documents
        </Link>
        <Link href="/b" tone="neutral" data-testid="neutral">
          Privacy
        </Link>
        <Link href="/c" underline="hover" tone="neutral" data-testid="both">
          Terms
        </Link>
      </>,
    );
    expect(byTestId('quiet').className).toBe('rd-link rd-link--quiet');
    expect(byTestId('neutral').className).toBe('rd-link rd-link--neutral');
    expect(byTestId('both').className).toBe('rd-link rd-link--quiet rd-link--neutral');
  });

  it('protects links that open a new tab, unless rel is given', () => {
    render(
      <>
        <Link href="https://example.com" target="_blank" data-testid="external">
          Electron docs
        </Link>
        <Link href="https://example.com" target="_blank" rel="author" data-testid="custom">
          Author
        </Link>
      </>,
    );
    expect(byTestId('external').getAttribute('rel')).toBe('noopener noreferrer');
    expect(byTestId('custom').getAttribute('rel')).toBe('author');
  });
});

describe('IconButton', () => {
  it('uses the label as its accessible name and reflects the pressed state', () => {
    const view = render(
      <IconButton label="Bold" pressed={false} data-testid="bold">
        <svg />
      </IconButton>,
    );
    const button = byTestId('bold');
    expect(button.getAttribute('aria-label')).toBe('Bold');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    view.rerender(
      <IconButton label="Bold" pressed data-testid="bold">
        <svg />
      </IconButton>,
    );
    expect(byTestId('bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('is not a toggle unless pressed is given, and accepts the icon as a prop', () => {
    render(<IconButton label="Search" icon={<svg data-testid="icon" />} data-testid="search" />);
    expect(byTestId('search').hasAttribute('aria-pressed')).toBe(false);
    expect(byTestId('search').contains(byTestId('icon'))).toBe(true);
  });

  it('shows its label as a tooltip on keyboard focus without repeating it as a description', async () => {
    render(
      <IconButton label="Keep on top" data-testid="pin">
        <svg />
      </IconButton>,
    );
    focus(byTestId('pin'));
    await flush();
    const tooltip = get('[role="tooltip"]');
    expect(tooltip.textContent).toBe('Keep on top');
    expect(byTestId('pin').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('LinkButton', () => {
  it('is an anchor, and protects links that open a new tab', () => {
    render(
      <>
        <LinkButton href="/docs" data-testid="internal">
          Documents
        </LinkButton>
        <LinkButton href="https://example.com" target="_blank" data-testid="external">
          Help
        </LinkButton>
        <LinkButton href="https://example.com" target="_blank" rel="author" data-testid="custom">
          Author
        </LinkButton>
      </>,
    );
    expect(byTestId('internal').tagName).toBe('A');
    expect(byTestId('internal').hasAttribute('rel')).toBe(false);
    expect(byTestId('external').getAttribute('rel')).toBe('noopener noreferrer');
    expect(byTestId('custom').getAttribute('rel')).toBe('author');
    expect(byTestId('internal').className).toContain('rd-btn--secondary');
  });
});

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens on keyboard focus, describes its child, and closes on blur', async () => {
    render(
      <>
        <Tooltip content="Follows the newest edit">
          <Button data-testid="target">Follow latest</Button>
        </Tooltip>
        <Button data-testid="other">Other</Button>
      </>,
    );
    expect(query('[role="tooltip"]')).toBeNull();
    focus(byTestId('target'));
    await flush();
    const tooltip = get('[role="tooltip"]');
    expect(tooltip.textContent).toBe('Follows the newest edit');
    expect(byTestId('target').getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.parentElement).toBe(document.body);
    focus(byTestId('other'));
    expect(query('[role="tooltip"]')).toBeNull();
    expect(byTestId('target').hasAttribute('aria-describedby')).toBe(false);
  });

  it('hides on Escape without moving focus', async () => {
    render(
      <Tooltip content="Follows the newest edit">
        <Button data-testid="target">Follow latest</Button>
      </Tooltip>,
    );
    focus(byTestId('target'));
    await flush();
    expect(query('[role="tooltip"]')).not.toBeNull();
    press('Escape');
    expect(query('[role="tooltip"]')).toBeNull();
    expect(document.activeElement).toBe(byTestId('target'));
  });

  const over = (element: Element, relatedTarget: Element | null = null): void => {
    act(() => {
      element.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', relatedTarget }),
      );
    });
  };
  const out = (element: Element, relatedTarget: Element | null = null): void => {
    act(() => {
      element.dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget }),
      );
    });
  };

  it('opens after a delay on hover, stays while hovered itself, and hides on leave', async () => {
    vi.useFakeTimers();
    // Step past the window in which a tooltip closed by an earlier test counts as "just seen".
    vi.advanceTimersByTime(5_000);
    render(
      <Tooltip content="Follows the newest edit" delayMs={300}>
        <Button data-testid="target">Follow latest</Button>
      </Tooltip>,
    );
    const target = byTestId('target');

    over(target);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(query('[role="tooltip"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const tooltip = get('[role="tooltip"]');

    // Moving from the button onto the tooltip keeps it open.
    out(target, tooltip);
    over(tooltip, target);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(query('[role="tooltip"]')).not.toBeNull();

    out(tooltip, document.body);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(query('[role="tooltip"]')).toBeNull();
  });

  it('skips the delay when moving straight from one tooltip to the next', async () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(5_000);
    render(
      <>
        <Tooltip content="Bold" delayMs={300}>
          <Button data-testid="bold">B</Button>
        </Tooltip>
        <Tooltip content="Italic" delayMs={300}>
          <Button data-testid="italic">I</Button>
        </Tooltip>
      </>,
    );
    over(byTestId('bold'));
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(get('[role="tooltip"]').textContent).toBe('Bold');
    out(byTestId('bold'), byTestId('italic'));
    over(byTestId('italic'), byTestId('bold'));
    act(() => {
      vi.advanceTimersByTime(120);
    });
    // "Bold" has gone and "Italic" is already showing, well inside its 300ms delay.
    expect(getAll('[role="tooltip"]').map((tooltip) => tooltip.textContent)).toEqual(['Italic']);
  });

  it('does not open for touch, when disabled, or without content', async () => {
    vi.useFakeTimers();
    render(
      <>
        <Tooltip content="Hint" delayMs={0}>
          <Button data-testid="touch">Touch</Button>
        </Tooltip>
        <Tooltip content="Hint" disabled>
          <Button data-testid="disabled">Disabled</Button>
        </Tooltip>
        <Tooltip content="">
          <Button data-testid="empty">Empty</Button>
        </Tooltip>
      </>,
    );
    act(() => {
      byTestId('touch').dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }),
      );
      vi.advanceTimersByTime(1_000);
    });
    focus(byTestId('disabled'));
    focus(byTestId('empty'));
    expect(query('[role="tooltip"]')).toBeNull();
  });

  it('keeps the child handlers working', async () => {
    const onFocus = vi.fn();
    const onClick = vi.fn();
    render(
      <Tooltip content="Hint">
        <Button data-testid="target" onFocus={onFocus} onClick={onClick}>
          Target
        </Button>
      </Tooltip>,
    );
    focus(byTestId('target'));
    await flush();
    expect(query('[role="tooltip"]')).not.toBeNull();
    click(byTestId('target'));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Using the control dismisses its tooltip.
    expect(query('[role="tooltip"]')).toBeNull();
  });
});

describe('TextField, TextArea and Select', () => {
  it('ties label, hint and error to the input with generated ids', () => {
    render(
      <>
        <TextField label="Document title" hint="Shown in the dashboard." data-testid="title" />
        <TextField
          label="Email"
          error="Enter a full address."
          hint="For the invitation."
          data-testid="email"
        />
      </>,
    );
    const title = byTestId<HTMLInputElement>('title');
    const email = byTestId<HTMLInputElement>('email');
    expect(title.id).not.toBe('');
    expect(title.id).not.toBe(email.id);
    expect(labelFor(title)).toBe('Document title');
    expect(describedBy(title)).toBe('Shown in the dashboard.');
    expect(title.hasAttribute('aria-invalid')).toBe(false);

    expect(labelFor(email)).toBe('Email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    // The error is read before the hint.
    expect(describedBy(email)).toBe('Enter a full address. | For the invitation.');
  });

  it('keeps a caller-supplied id and describedby', () => {
    render(
      <>
        <p id="outside-help">Outside help</p>
        <TextField label="Title" id="doc-title" aria-describedby="outside-help" hint="Hint" />
      </>,
    );
    const input = get<HTMLInputElement>('#doc-title');
    expect(labelFor(input)).toBe('Title');
    expect(describedBy(input)).toBe('Outside help | Hint');
  });

  it('sends className and style to the wrapper and everything else to the input', () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <TextField
        label="Title"
        ref={ref}
        className="wide"
        style={{ maxWidth: 200 }}
        data-testid="title"
        name="title"
        placeholder="Untitled"
        maxLength={80}
        onChange={onChange}
      />,
    );
    const input = byTestId<HTMLInputElement>('title');
    expect(ref.current).toBe(input);
    expect(input.tagName).toBe('INPUT');
    expect(input.name).toBe('title');
    expect(input.placeholder).toBe('Untitled');
    expect(input.maxLength).toBe(80);
    const wrapper = input.closest('.rd-field') as HTMLElement;
    expect(wrapper.classList.contains('wide')).toBe(true);
    expect(wrapper.style.maxWidth).toBe('200px');
    setValue(input, 'Roadmap');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders prefix and suffix inside the box and marks required fields', () => {
    render(
      <TextField
        label="Server"
        prefix="https://"
        suffix=".example"
        required
        data-testid="server"
      />,
    );
    const box = byTestId('server').closest('.rd-input') as HTMLElement;
    expect(Array.from(box.children).map((child) => child.textContent)).toEqual([
      'https://',
      '',
      '.example',
    ]);
    expect(byTestId<HTMLInputElement>('server').required).toBe(true);
    expect(get('.rd-field__required').getAttribute('aria-hidden')).toBe('true');
  });

  it('can hide the label visually while keeping it for assistive technology', () => {
    render(<TextField label="Search documents" hideLabel data-testid="search" />);
    const label = get(`label[for="${byTestId('search').id}"]`);
    expect(label.classList.contains('rd-visually-hidden')).toBe(true);
  });

  it('wires a textarea the same way', () => {
    render(<TextArea label="Snapshot note" error="Add a note." data-testid="note" />);
    const area = byTestId<HTMLTextAreaElement>('note');
    expect(area.tagName).toBe('TEXTAREA');
    expect(labelFor(area)).toBe('Snapshot note');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(area)).toBe('Add a note.');
  });

  it('renders options, a placeholder, and reports changes both ways', () => {
    const onValueChange = vi.fn();
    const onChange = vi.fn();
    function Harness() {
      const [value, setValueState] = useState('');
      return (
        <Select
          label="Link expires"
          placeholder="Choose"
          value={value}
          onChange={onChange}
          onValueChange={(next) => {
            onValueChange(next);
            setValueState(next);
          }}
          data-testid="expiry"
          options={[
            { value: '1d', label: 'In 1 day' },
            { value: '7d', label: 'In 7 days' },
            { value: 'never', label: 'Never', disabled: true },
          ]}
        />
      );
    }
    render(<Harness />);
    const select = byTestId<HTMLSelectElement>('expiry');
    expect(select.tagName).toBe('SELECT');
    expect(labelFor(select)).toBe('Link expires');
    const options = Array.from(select.options);
    expect(options.map((option) => option.textContent)).toEqual([
      'Choose',
      'In 1 day',
      'In 7 days',
      'Never',
    ]);
    expect(options[0]?.disabled).toBe(true);
    expect(options[3]?.disabled).toBe(true);
    setValue(select, '7d');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('7d');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(select.value).toBe('7d');
  });

  it('accepts option elements as children', () => {
    render(
      <Select aria-label="Role" defaultValue="editor" data-testid="role">
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </Select>,
    );
    expect(byTestId<HTMLSelectElement>('role').value).toBe('editor');
    expect(byTestId('role').getAttribute('aria-label')).toBe('Role');
  });
});

describe('Field', () => {
  it('labels and describes a plain child through htmlFor', () => {
    render(
      <Field label="Colour" hint="Used for your cursor." htmlFor="cursor-colour">
        <input id="cursor-colour" type="color" />
      </Field>,
    );
    expect(get('label').getAttribute('for')).toBe('cursor-colour');
    expect(get('.rd-field__hint').textContent).toBe('Used for your cursor.');
  });

  it('hands ids and ARIA state to a custom control', () => {
    render(
      <Field
        label="Access"
        hint="Viewers cannot edit."
        error="Choose one."
        required
        data-testid="field"
      >
        {(control) => <div role="radiogroup" data-testid="group" {...control} />}
      </Field>,
    );
    const group = byTestId('group');
    expect(group.id).not.toBe('');
    expect(
      document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
    ).toContain('Access');
    expect(describedBy(group)).toBe('Choose one. | Viewers cannot edit.');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(byTestId('field').hasAttribute('data-invalid')).toBe(true);
  });
});

describe('Checkbox', () => {
  it('is a native checkbox named by its label and described by its hint', () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        label="Include images"
        hint="Markdown links to them instead."
        onCheckedChange={onCheckedChange}
        data-testid="images"
      />,
    );
    const input = byTestId<HTMLInputElement>('images');
    expect(input.type).toBe('checkbox');
    expect(input.closest('label')?.textContent).toContain('Include images');
    expect(describedBy(input)).toBe('Markdown links to them instead.');
    click(input);
    expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(input.checked).toBe(true);
  });

  it('sets the indeterminate DOM property', () => {
    const view = render(<Checkbox label="Select all" indeterminate data-testid="all" />);
    expect(byTestId<HTMLInputElement>('all').indeterminate).toBe(true);
    view.rerender(<Checkbox label="Select all" data-testid="all" />);
    expect(byTestId<HTMLInputElement>('all').indeterminate).toBe(false);
  });

  it('forwards a ref and does not fire when disabled', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox label="Allow downloads" disabled ref={ref} data-testid="downloads" />);
    expect(ref.current).toBe(byTestId('downloads'));
    expect(byTestId<HTMLInputElement>('downloads').disabled).toBe(true);
    expect(byTestId('downloads').closest('label')?.hasAttribute('data-disabled')).toBe(true);
  });
});

describe('Switch', () => {
  it('is a controlled switch that reports the new state', () => {
    const onCheckedChange = vi.fn();
    function Harness() {
      const [checked, setChecked] = useState(false);
      return (
        <Switch
          label="Follow latest edits"
          hint="Pauses while you scroll."
          checked={checked}
          onCheckedChange={(next) => {
            onCheckedChange(next);
            setChecked(next);
          }}
          data-testid="follow"
        />
      );
    }
    render(<Harness />);
    const input = byTestId<HTMLInputElement>('follow');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.checked).toBe(false);
    expect(input.closest('label')?.textContent).toContain('Follow latest edits');
    expect(describedBy(input)).toBe('Pauses while you scroll.');
    click(input);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(input.checked).toBe(true);
    click(input);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(input.checked).toBe(false);
  });

  it('stays put when the parent does not accept the change', () => {
    render(
      <Switch
        aria-label="Keep on top"
        checked
        onCheckedChange={() => undefined}
        data-testid="pin"
      />,
    );
    const input = byTestId<HTMLInputElement>('pin');
    click(input);
    expect(input.checked).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Keep on top');
  });
});

describe('Slider', () => {
  it('is a labelled range input that reports numbers and formats its value', () => {
    const onValueChange = vi.fn();
    function Harness() {
      const [value, setValueState] = useState(70);
      return (
        <Slider
          label="Panel background"
          min={20}
          max={100}
          step={5}
          value={value}
          onValueChange={(next) => {
            onValueChange(next);
            setValueState(next);
          }}
          formatValue={(current) => `${current}%`}
          data-testid="alpha"
        />
      );
    }
    render(<Harness />);
    const input = byTestId<HTMLInputElement>('alpha');
    expect(input.type).toBe('range');
    expect([input.min, input.max, input.step, input.value]).toEqual(['20', '100', '5', '70']);
    expect(labelFor(input)).toBe('Panel background');
    expect(input.getAttribute('aria-valuetext')).toBe('70%');
    expect(get('output').textContent).toBe('70%');
    expect(get('output').getAttribute('for')).toBe(input.id);
    // (70 - 20) / (100 - 20)
    expect(input.style.getPropertyValue('--rd-slider-fill')).toBe('62.50%');

    setValue(input, '45');
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith(45);
    expect(get('output').textContent).toBe('45%');
    expect(input.getAttribute('aria-valuetext')).toBe('45%');
    expect(input.style.getPropertyValue('--rd-slider-fill')).toBe('31.25%');
  });

  it('works uncontrolled and without a visible label', () => {
    render(
      <Slider
        aria-label="Text size"
        defaultValue={16}
        min={12}
        max={24}
        hideValue
        data-testid="size"
      />,
    );
    const input = byTestId<HTMLInputElement>('size');
    expect(input.value).toBe('16');
    expect(query('output')).toBeNull();
    setValue(input, '20');
    expect(input.value).toBe('20');
  });
});

describe('SegmentedControl', () => {
  function Harness({ onValueChange }: { onValueChange: (value: string) => void }) {
    const [value, setValueState] = useState('view');
    return (
      <SegmentedControl
        ariaLabel="Access"
        value={value}
        onValueChange={(next) => {
          onValueChange(next);
          setValueState(next);
        }}
        data-testid="access"
        options={[
          { value: 'view', label: 'Can view' },
          { value: 'comment', label: 'Can comment', disabled: true },
          { value: 'edit', label: 'Can edit' },
        ]}
      />
    );
  }

  it('is a labelled radio group with one tab stop on the selected option', () => {
    render(<Harness onValueChange={() => undefined} />);
    const group = byTestId('access');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Access');
    const radios = getAll<HTMLButtonElement>('[role="radio"]');
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    expect(radios[1]?.disabled).toBe(true);
  });

  it('selects on click and with the arrow keys, skipping disabled options', () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const radios = getAll('[role="radio"]');
    focus(radios[0] as HTMLElement);
    expect(press('ArrowRight')).toBe(false);
    expect(onValueChange).toHaveBeenLastCalledWith('edit');
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2]?.getAttribute('aria-checked')).toBe('true');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);

    // Wraps, and Up/Down work like Left/Right.
    press('ArrowDown');
    expect(onValueChange).toHaveBeenLastCalledWith('view');
    press('ArrowUp');
    expect(onValueChange).toHaveBeenLastCalledWith('edit');
    press('Home');
    expect(onValueChange).toHaveBeenLastCalledWith('view');
    press('End');
    expect(onValueChange).toHaveBeenLastCalledWith('edit');

    click(radios[0] as HTMLElement);
    expect(onValueChange).toHaveBeenLastCalledWith('view');
    onValueChange.mockClear();
    click(radios[0] as HTMLElement);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('keeps labels for assistive technology when showing icons only', () => {
    render(
      <SegmentedControl
        ariaLabel="Alignment"
        iconOnly
        value="start"
        onValueChange={() => undefined}
        options={[
          { value: 'start', label: 'Align left', icon: <svg /> },
          { value: 'end', label: 'Align right', icon: <svg /> },
        ]}
      />,
    );
    const first = get('[role="radio"]');
    expect(first.textContent).toBe('Align left');
    expect(first.getAttribute('title')).toBe('Align left');
    expect(get('.rd-segmented__label').classList.contains('rd-visually-hidden')).toBe(true);
  });
});

describe('Tabs', () => {
  function Harness({ activation }: { activation?: 'auto' | 'manual' }) {
    const [tab, setTab] = useState('people');
    return (
      <Tabs
        ariaLabel="Sharing"
        activation={activation}
        value={tab}
        onValueChange={setTab}
        data-testid="tabs"
        tabs={[
          { id: 'people', label: 'People', badge: 4 },
          { id: 'links', label: 'Share links' },
          { id: 'trash', label: 'Trash', disabled: true },
          { id: 'history', label: 'Snapshots' },
        ]}
      >
        <TabPanel id="people">People panel</TabPanel>
        <TabPanel id="links">Links panel</TabPanel>
        <TabPanel id="history" keepMounted>
          History panel
        </TabPanel>
      </Tabs>
    );
  }

  it('links each tab to its panel', () => {
    render(<Harness />);
    const list = get('[role="tablist"]');
    expect(list.getAttribute('aria-label')).toBe('Sharing');
    const tabs = getAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(tabs[0]?.textContent).toBe('People4');

    const panel = get('[role="tabpanel"]:not([hidden])');
    expect(panel.textContent).toBe('People panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.tabIndex).toBe(0);
    // Unselected panels are unmounted, unless asked to stay.
    expect(getAll('[role="tabpanel"]')).toHaveLength(2);
    expect(get('[role="tabpanel"][hidden]').textContent).toBe('History panel');
  });

  it('switches with the arrow keys, skipping disabled tabs and wrapping', () => {
    render(<Harness />);
    const tabs = getAll('[role="tab"]');
    focus(tabs[0] as HTMLElement);
    expect(press('ArrowRight')).toBe(false);
    expect(document.activeElement).toBe(tabs[1]);
    expect(get('[role="tabpanel"]:not([hidden])').textContent).toBe('Links panel');
    press('ArrowRight');
    expect(document.activeElement).toBe(tabs[3]);
    expect(get('[role="tabpanel"]:not([hidden])').textContent).toBe('History panel');
    press('ArrowRight');
    expect(document.activeElement).toBe(tabs[0]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(tabs[3]);
    press('Home');
    expect(document.activeElement).toBe(tabs[0]);
    press('End');
    expect(document.activeElement).toBe(tabs[3]);
  });

  it('waits for a click or Enter with manual activation', () => {
    render(<Harness activation="manual" />);
    const tabs = getAll('[role="tab"]');
    focus(tabs[0] as HTMLElement);
    press('ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);
    expect(get('[role="tabpanel"]:not([hidden])').textContent).toBe('People panel');
    click(tabs[1] as HTMLElement);
    expect(get('[role="tabpanel"]:not([hidden])').textContent).toBe('Links panel');
  });

  it('lets a panel be used on its own', () => {
    render(
      <>
        <Tabs
          id="doc-tabs"
          value="a"
          onValueChange={() => undefined}
          tabs={[
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ]}
        />
        <TabPanel id="a" tabsId="doc-tabs" data-testid="panel-a">
          A
        </TabPanel>
        <TabPanel id="b" tabsId="doc-tabs" active={false} data-testid="panel-b">
          B
        </TabPanel>
      </>,
    );
    expect(byTestId('panel-a').getAttribute('aria-labelledby')).toBe('doc-tabs-tab-a');
    expect(document.getElementById('doc-tabs-tab-a')?.textContent).toBe('A');
    expect(query('[data-testid="panel-b"]')).toBeNull();
  });
});

describe('CopyField', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    vi.useRealTimers();
  });

  function mockClipboard(result: 'ok' | 'fail') {
    const writeText = vi.fn(() =>
      result === 'ok' ? Promise.resolve() : Promise.reject(new Error('denied')),
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    return writeText;
  }

  it('is a labelled read-only field', () => {
    render(
      <CopyField label="Share link" value="https://docs.example.test/s/abc" data-testid="link" />,
    );
    const input = byTestId<HTMLInputElement>('link');
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('https://docs.example.test/s/abc');
    expect(labelFor(input)).toBe('Share link');
  });

  it('selects nothing when focus arrives from a script', () => {
    const onFocus = vi.fn();
    render(
      <CopyField
        label="Share link"
        value="https://docs.example.test/s/abc"
        onFocus={onFocus}
        data-testid="link"
      />,
    );
    const input = byTestId<HTMLInputElement>('link');
    focus(input);
    expect(document.activeElement).toBe(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it('selects the whole value on a click, ready to copy', () => {
    const onClick = vi.fn();
    render(
      <CopyField
        label="Share link"
        value="https://docs.example.test/s/abc"
        onClick={onClick}
        data-testid="link"
      />,
    );
    const input = byTestId<HTMLInputElement>('link');
    focus(input);
    click(input);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('keeps a selection the user dragged out themselves', () => {
    render(
      <CopyField label="Share link" value="https://docs.example.test/s/abc" data-testid="link" />,
    );
    const input = byTestId<HTMLInputElement>('link');
    focus(input);
    act(() => input.setSelectionRange(8, 25));
    // The click that ends a drag, or the second click of a double-click.
    click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 25]);
  });

  it('leaves the selection alone when the caller handles the click', () => {
    render(
      <CopyField
        label="Share link"
        value="https://docs.example.test/s/abc"
        onClick={(event) => event.preventDefault()}
        data-testid="link"
      />,
    );
    const input = byTestId<HTMLInputElement>('link');
    focus(input);
    click(input);
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it('copies the value, confirms it briefly, and tells the caller', async () => {
    vi.useFakeTimers();
    const writeText = mockClipboard('ok');
    const onCopied = vi.fn();
    render(
      <CopyField label="Share link" value="https://docs.example.test/s/abc" onCopied={onCopied} />,
    );
    const button = get('.rd-copy__button');
    expect(button.textContent).toBe('Copy');
    click(button);
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://docs.example.test/s/abc');
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Copied');
    expect(get('[role="status"]').textContent).toBe('Copied');
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(button.textContent).toBe('Copy');
    expect(get('[role="status"]').textContent).toBe('');
  });

  it('hides a masked value until revealed, but always copies the real one', async () => {
    const writeText = mockClipboard('ok');
    render(
      <CopyField
        label="Invitation link"
        value="https://docs.example.test/invite/secret"
        masked
        data-testid="link"
      />,
    );
    const input = byTestId<HTMLInputElement>('link');
    expect(input.value).not.toContain('secret');
    expect(input.value).toMatch(/^•+$/);
    // The mask does not reveal the length either.
    expect(input.value).toHaveLength(24);

    click(get('.rd-copy__button'));
    await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://docs.example.test/invite/secret');

    const reveal = get('.rd-copy__reveal');
    expect(reveal.getAttribute('aria-label')).toBe('Show');
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    click(reveal);
    expect(input.value).toBe('https://docs.example.test/invite/secret');
    expect(reveal.getAttribute('aria-label')).toBe('Hide');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
  });

  it('says so when copying fails and leaves the value ready to copy by hand', async () => {
    mockClipboard('fail');
    const onCopied = vi.fn();
    render(
      <CopyField
        label="Share link"
        value="https://docs.example.test/s/abc"
        masked
        onCopied={onCopied}
        data-testid="link"
      />,
    );
    click(get('.rd-copy__button'));
    await flush();
    expect(onCopied).not.toHaveBeenCalled();
    expect(get('[role="status"]').textContent).toContain('Copy failed');
    expect(byTestId<HTMLInputElement>('link').value).toBe('https://docs.example.test/s/abc');
  });
});

describe('status and feedback', () => {
  it('writes the state next to the dot and hides the dot from assistive technology', () => {
    render(<StatusDot tone="warning" pulse label="Reconnecting" data-testid="status" />);
    const status = byTestId('status');
    expect(status.textContent).toBe('Reconnecting');
    expect(status.classList.contains('rd-tone-warning')).toBe(true);
    const dot = get('.rd-status__dot');
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.hasAttribute('data-pulse')).toBe(true);
  });

  it('applies the tone to badges', () => {
    render(
      <>
        <Badge data-testid="plain">Viewer</Badge>
        <Badge tone="danger" data-testid="danger">
          Revoked
        </Badge>
      </>,
    );
    expect(byTestId('plain').className).toBe('rd-badge rd-tone-neutral');
    expect(byTestId('danger').className).toBe('rd-badge rd-tone-danger');
  });

  it('announces a spinner, unless it is decorative', () => {
    render(
      <>
        <Spinner data-testid="loud" label="Loading documents" />
        <Spinner data-testid="quiet" label={null} />
      </>,
    );
    expect(byTestId('loud').getAttribute('role')).toBe('status');
    expect(byTestId('loud').textContent).toBe('Loading documents');
    expect(byTestId('quiet').getAttribute('aria-hidden')).toBe('true');
    expect(byTestId('quiet').hasAttribute('role')).toBe(false);
  });

  it('hides skeletons from assistive technology and renders the requested lines', () => {
    render(
      <>
        <Skeleton width={120} height={12} data-testid="one" />
        <Skeleton lines={3} data-testid="many" />
      </>,
    );
    expect(byTestId('one').getAttribute('aria-hidden')).toBe('true');
    expect(byTestId('one').style.width).toBe('120px');
    expect(byTestId('many').children).toHaveLength(3);
  });

  it('interrupts for problems and waits for everything else', () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Banner tone="danger" title="Not saved" data-testid="danger">
          The server could not store your edits.
        </Banner>
        <Banner tone="info" onDismiss={onDismiss} data-testid="info">
          You are viewing this document.
        </Banner>
      </>,
    );
    expect(byTestId('danger').getAttribute('role')).toBe('alert');
    expect(byTestId('info').getAttribute('role')).toBe('status');
    expect(byTestId('danger').textContent).toBe('Not savedThe server could not store your edits.');
    const dismiss = get('[data-testid="info"] .rd-banner__dismiss');
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(query('[data-testid="danger"] .rd-banner__dismiss')).toBeNull();
  });

  it('gives empty and error states a heading, a way forward, and a code to quote', () => {
    render(
      <>
        <EmptyState
          title="No documents yet"
          description="Create one to get started."
          action={<Button>New document</Button>}
          data-testid="empty"
        />
        <ErrorState
          title="This link was revoked"
          description="Ask for a new one."
          code="LINK_REVOKED"
          headingLevel={1}
          data-testid="error"
        />
      </>,
    );
    expect(get('[data-testid="empty"] h2').textContent).toBe('No documents yet');
    expect(get('[data-testid="empty"] button').textContent).toBe('New document');
    expect(byTestId('error').getAttribute('role')).toBe('alert');
    expect(get('[data-testid="error"] h1').textContent).toBe('This link was revoked');
    expect(get('[data-testid="error"] code').textContent).toBe('LINK_REVOKED');
  });
});

describe('Avatar', () => {
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map(
      (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
    );
    const [r, g, b] = channels.map((unit) =>
      unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4,
    ) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastOf(element: HTMLElement): number {
    const background = luminance(element.style.getPropertyValue('--rd-avatar-bg'));
    const text = luminance(element.style.getPropertyValue('--rd-avatar-fg'));
    return (Math.max(background, text) + 0.05) / (Math.min(background, text) + 0.05);
  }

  it('shows initials and names the person for assistive technology', () => {
    render(
      <>
        <Avatar name="Asha Rao" data-testid="two" />
        <Avatar name="  marcus  " data-testid="one" />
        <Avatar name="Tomás de Oliveira" data-testid="three" />
        <Avatar name="प्रिया शर्मा" data-testid="hindi" />
        <Avatar name="" data-testid="none" />
      </>,
    );
    expect(byTestId('two').textContent).toBe('AR');
    expect(byTestId('two').getAttribute('role')).toBe('img');
    expect(byTestId('two').getAttribute('aria-label')).toBe('Asha Rao');
    expect(byTestId('one').textContent).toBe('M');
    expect(byTestId('three').textContent).toBe('TO');
    // Starts with the first Devanagari letter; never an empty or Latin fallback.
    expect(byTestId('hindi').textContent?.startsWith('प')).toBe(true);
    expect(byTestId('none').textContent).toBe('?');
  });

  it('derives a stable colour from the name', () => {
    render(
      <>
        <Avatar name="Asha Rao" data-testid="a" />
        <Avatar name="asha rao " data-testid="b" />
        <Avatar name="Marcus Lindqvist" data-testid="c" />
      </>,
    );
    const colour = (id: string): string => byTestId(id).style.getPropertyValue('--rd-avatar-bg');
    expect(colour('a')).toMatch(/^#[0-9a-f]{6}$/);
    expect(colour('a')).toBe(colour('b'));
    expect(colour('c')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps initials readable on every generated colour', () => {
    const names = Array.from({ length: 80 }, (_, index) => `Person ${index} ${index * 7919}`);
    render(
      <>
        {names.map((name) => (
          <Avatar key={name} name={name} />
        ))}
      </>,
    );
    const avatars = getAll('.rd-avatar');
    const colours = new Set(
      avatars.map((avatar) => avatar.style.getPropertyValue('--rd-avatar-bg')),
    );
    // The palette is actually used, not a single colour.
    expect(colours.size).toBeGreaterThanOrEqual(8);
    for (const avatar of avatars) expect(contrastOf(avatar)).toBeGreaterThanOrEqual(7);
  });

  it('picks dark or light initials for a caller-supplied colour', () => {
    render(
      <>
        <Avatar name="Wen Li" color="#ffd84d" data-testid="light" />
        <Avatar name="Wen Li" color="#1d3b8f" data-testid="dark" />
        <Avatar name="Wen Li" color="rgb(200, 30, 30)" data-testid="rgb" />
        <Avatar name="Wen Li" color="hsl(160 80% 40%)" data-testid="hsl" />
      </>,
    );
    expect(byTestId('light').style.getPropertyValue('--rd-avatar-fg')).toBe('#0a1215');
    expect(byTestId('dark').style.getPropertyValue('--rd-avatar-fg')).toBe('#ffffff');
    expect(contrastOf(byTestId('light'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(byTestId('dark'))).toBeGreaterThanOrEqual(4.5);
    expect(byTestId('rgb').style.getPropertyValue('--rd-avatar-fg')).toBe('#ffffff');
    expect(byTestId('hsl').style.getPropertyValue('--rd-avatar-fg')).toBe('#0a1215');
  });

  it('collapses a long stack into a counter that still names everyone', () => {
    const people = ['Asha Rao', 'Marcus Lindqvist', 'Wen Li', 'Noor Haddad', 'Tomás Oliveira'].map(
      (name, index) => ({ id: `u${index}`, name }),
    );
    render(<AvatarStack people={people} max={3} data-testid="stack" />);
    const stack = byTestId('stack');
    expect(stack.getAttribute('role')).toBe('group');
    expect(stack.getAttribute('aria-label')).toBe('5 people');
    const avatars = getAll('[data-testid="stack"] .rd-avatar');
    expect(avatars.map((avatar) => avatar.textContent)).toEqual(['AR', 'ML', '+3']);
    expect(avatars[2]?.getAttribute('aria-label')).toBe(
      '3 more: Wen Li, Noor Haddad, Tomás Oliveira',
    );
  });

  it('shows everyone when they fit, and uses the title as the accessible name', () => {
    render(
      <AvatarStack
        people={[
          { id: 'a', name: 'Asha Rao', title: 'Asha Rao is editing' },
          { id: 'b', name: 'Wen Li' },
        ]}
        max={2}
      />,
    );
    const avatars = getAll('.rd-avatar');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]?.getAttribute('aria-label')).toBe('Asha Rao is editing');
    expect(get('[role="group"]').getAttribute('aria-label')).toBe('2 people');
  });
});
