/** Code block node view: language menu, copy button, preserved whitespace. */
import { Button, Select, copyText } from '@realtimedocs/ui';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Check, Copy } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { CODE_LANGUAGES, resolveLanguage } from '../highlight';
import { useRuntime } from '../runtime';
import { useValueStore } from '../store';

const PLAIN = 'plain';
const OPTIONS = [{ value: PLAIN, label: 'Plain text' }, ...CODE_LANGUAGES];
const LABELS = new Map(OPTIONS.map((option) => [option.value, option.label]));

interface BarProps {
  language: string;
  editable: boolean;
  onLanguage: (value: string) => void;
  onCopy: () => Promise<boolean>;
}

/** Memoised: typing inside the block does not re-render the menu. */
const CodeBar = memo(function CodeBar({ language, editable, onLanguage, onCopy }: BarProps) {
  const [copied, setCopied] = useState(false);
  const known = LABELS.has(language);
  return (
    <div className="rd-block-bar" contentEditable={false}>
      {editable ? (
        <Select
          size="sm"
          aria-label="Code language"
          className="rd-code__language"
          value={known ? language : '__other'}
          onValueChange={onLanguage}
          options={known ? OPTIONS : [...OPTIONS, { value: '__other', label: language }]}
        />
      ) : (
        <span className="rd-block-bar__title">{LABELS.get(language) ?? language}</span>
      )}
      <span className="rd-block-bar__actions">
        <Button
          size="sm"
          variant="ghost"
          iconLeft={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => {
            void onCopy().then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </span>
    </div>
  );
});

function CodeBlockViewInner({ node, updateAttributes }: ReactNodeViewProps) {
  const runtime = useRuntime();
  const editable = useValueStore(runtime.editable);
  const language = resolveLanguage(node.attrs.language) ?? PLAIN;
  // Stable callbacks: the bar only re-renders when the language or mode changes.
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const update = useRef(updateAttributes);
  update.current = updateAttributes;
  const [handlers] = useState(() => ({
    onLanguage: (value: string) => {
      if (value === '__other') return;
      update.current({ language: value === PLAIN ? null : value });
    },
    onCopy: () => copyText(nodeRef.current.textContent),
  }));

  return (
    <NodeViewWrapper className="rd-code" data-language={language}>
      <CodeBar
        language={language}
        editable={editable}
        onLanguage={handlers.onLanguage}
        onCopy={handlers.onCopy}
      />
      <pre className="rd-code__pre" spellCheck={false}>
        <NodeViewContent<'code'> as="code" className="hljs" style={{ whiteSpace: 'pre' }} />
      </pre>
    </NodeViewWrapper>
  );
}

export const CodeBlockView = memo(CodeBlockViewInner);
