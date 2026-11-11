import { useNow } from '../lib/hooks';
import { formatDateTime, formatRelativeTime, type TimeInput, toEpochMs } from '../lib/time';

export interface RelativeTimeProps {
  value: TimeInput;
  /** Text before the phrase, for example `Edited`. */
  prefix?: string;
  className?: string;
}

/** "5 minutes ago", kept current, with the exact date and time on hover. */
export function RelativeTime({ value, prefix, className }: RelativeTimeProps) {
  const now = useNow();
  const ms = toEpochMs(value);
  if (Number.isNaN(ms)) return null;
  const phrase = formatRelativeTime(ms, now);
  return (
    <time className={className} dateTime={new Date(ms).toISOString()} title={formatDateTime(ms)}>
      {prefix ? `${prefix} ${phrase}` : phrase}
    </time>
  );
}
