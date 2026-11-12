import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from '../../../components/Brand';
import { useReducedMotion } from '../useReducedMotion';
import './demo.css';

/** One scene per behaviour the demo shows. The order is the loop. */
const SCENES = [
  { id: 'type', tab: 'Typing', caption: 'Text is typed into the shared document.' },
  {
    id: 'people',
    tab: 'Collaborators',
    caption: 'A candidate and an interviewer edit at the same time, each with a labelled cursor.',
  },
  { id: 'margins', tab: 'Margins', caption: 'Drag a ruler marker and the page margin follows.' },
  {
    id: 'panel',
    tab: 'Presenter',
    caption: 'Private Presenter Mode opens a floating, translucent panel with its status line.',
  },
  { id: 'save', tab: 'Saving', caption: 'The save state moves from Saving… to Saved.' },
  { id: 'presence', tab: 'Presence', caption: 'More people join and show up with their role.' },
] as const;

const SCENE_MS = 4600;

function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setInView(last.isIntersecting);
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function Avatar({ letter, tone }: { letter: string; tone: string }) {
  return <b className={`demo__avatar demo__avatar--${tone}`}>{letter}</b>;
}

function Stage() {
  return (
    <div className="demo__stage" aria-hidden="true">
      <div className="demo__bar">
        <span className="demo__lights">
          <i />
          <i />
          <i />
        </span>
        <BrandMark className="demo__mark" />
        <span className="demo__title">Acme · Round 2 · System design</span>
        <span className="demo__save">
          <span className="demo__save-a">Saving…</span>
          <span className="demo__save-b">Saved</span>
        </span>
        <span className="demo__people">
          <Avatar letter="M" tone="you" />
          <Avatar letter="A" tone="a" />
          <Avatar letter="N" tone="n" />
          <Avatar letter="P" tone="p" />
        </span>
      </div>

      <div className="demo__ruler">
        <span className="demo__ticks" />
        <span className="demo__marker demo__marker--l" />
        <span className="demo__marker demo__marker--r" />
        <span className="demo__grab" />
      </div>

      <div className="demo__page">
        <span className="demo__guide" />
        <div className="demo__text">
          <p className="demo__h">Design a service that shortens links</p>
          <p className="demo__line demo__line--1" style={{ '--n': 38 } as React.CSSProperties}>
            <span>Meera: walk me through the API first.</span>
            <i className="demo__caret demo__caret--you" />
          </p>
          <p className="demo__line demo__line--2" style={{ '--n': 42 } as React.CSSProperties}>
            <span>POST /links returns a short code.</span>
            <i className="demo__caret demo__caret--a" />
            <em className="demo__flag demo__flag--a">Aarav — Candidate</em>
          </p>
          <p className="demo__line demo__line--3" style={{ '--n': 38 } as React.CSSProperties}>
            <span>How do you avoid two equal codes?</span>
            <i className="demo__caret demo__caret--n" />
            <em className="demo__flag demo__flag--n">Naman — Interviewer</em>
          </p>
          <ul className="demo__list">
            <li>Requirements and limits</li>
            <li>Data model and storage</li>
            <li>Failure modes</li>
          </ul>
        </div>
      </div>

      <div className="demo__roster">
        <p>In this session</p>
        <ul>
          <li>
            <Avatar letter="A" tone="a" /> Aarav — Candidate
          </li>
          <li>
            <Avatar letter="N" tone="n" /> Naman — Interviewer
          </li>
          <li className="demo__joined">
            <Avatar letter="P" tone="p" /> Priya — Interviewer
          </li>
        </ul>
      </div>

      <div className="demo__panel">
        <p className="demo__panel-head">
          <span className="demo__dot" /> Presenter
        </p>
        <p className="demo__status">OS protection accepted</p>
        <p className="demo__status demo__status--warn">Manual verification required</p>
        <p className="demo__panel-line">Follow up on collisions</p>
        <p className="demo__panel-line demo__panel-line--dim">Ask about caching</p>
        <span className="demo__slider" />
      </div>
    </div>
  );
}

/**
 * The product demonstration: a drawn document window that plays through six scenes. It is HTML
 * and CSS moved by `transform` and `opacity` only; React holds one number, the scene. It never
 * advances while off-screen, while the tab is hidden, or when the visitor asked for reduced
 * motion (then the scenes are static states the visitor steps through).
 */
export default function ProductDemo() {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const pageVisible = usePageVisible();
  const [scene, setScene] = useState(0);
  const [wantsPlay, setWantsPlay] = useState(true);
  const playing = wantsPlay && !reduced;
  const running = playing && inView && pageVisible;

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setScene((value) => (value + 1) % SCENES.length),
      SCENE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [running, scene]);

  const go = useCallback((index: number) => {
    setScene((index + SCENES.length) % SCENES.length);
  }, []);

  const reached = SCENES.map((_, index) => (index <= scene ? `s${index}` : '')).join(' ');
  const current = SCENES[scene] ?? SCENES[0];

  return (
    <div
      ref={rootRef}
      className={`demo ${reached} ${reduced ? 'demo--still' : ''}`}
      data-scene={scene}
      data-playing={running ? 'true' : 'false'}
      data-testid="product-demo"
    >
      <Stage />
      <div className="demo__controls">
        {reduced ? (
          <p className="demo__still-note">Motion is reduced. Step through the scenes.</p>
        ) : (
          <button
            type="button"
            className="demo__btn"
            aria-pressed={!playing}
            onClick={() => setWantsPlay((value) => !value)}
            data-testid="demo-play"
          >
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            <span>{playing ? 'Pause demo' : 'Play demo'}</span>
          </button>
        )}
        <button
          type="button"
          className="demo__btn demo__btn--icon"
          onClick={() => go(scene - 1)}
          data-testid="demo-prev"
        >
          <SkipBack aria-hidden="true" />
          <span className="lp-sr">Previous scene</span>
        </button>
        <button
          type="button"
          className="demo__btn demo__btn--icon"
          onClick={() => go(scene + 1)}
          data-testid="demo-next"
        >
          <SkipForward aria-hidden="true" />
          <span className="lp-sr">Next scene</span>
        </button>
        <div className="demo__tabs" role="group" aria-label="Demo scenes">
          {SCENES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="demo__tab"
              aria-pressed={index === scene}
              onClick={() => setScene(index)}
            >
              {item.tab}
            </button>
          ))}
        </div>
      </div>
      <p className="demo__caption" data-testid="demo-caption">
        {current?.caption}
      </p>
    </div>
  );
}
