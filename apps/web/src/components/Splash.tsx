import { BrandMark } from './Brand';

/** Shown while the app finds out who is signed in and loads the first screen. */
export function Splash({ label = 'Loading RealtimeDocs' }: { label?: string }) {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <BrandMark className="app-splash__mark" blink />
      <span className="rd-visually-hidden">{label}</span>
    </div>
  );
}
