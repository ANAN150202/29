import { useEffect, useRef, useState } from 'react';
import { sfx } from '../game/sound';

/** Countdown bar driven by the server's remaining time (immune to clock skew). */
export function TurnTimer({
  leftMs,
  totalMs,
  resetKey,
  tickSound = false,
}: {
  leftMs: number | null;
  totalMs: number | null;
  resetKey: string | number;
  tickSound?: boolean;
}) {
  const lastTick = useRef<number | null>(null);
  const receivedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    receivedAt.current = Date.now();
    setNow(Date.now());
  }, [resetKey, leftMs]);
  useEffect(() => {
    if (leftMs === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [leftMs]);
  if (leftMs === null || !totalMs) return null;
  const remaining = Math.max(0, leftMs - (now - receivedAt.current));
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  const secs = Math.ceil(remaining / 1000);
  if (tickSound && secs <= 5 && secs > 0 && lastTick.current !== secs) {
    lastTick.current = secs;
    sfx.tick();
  }
  return (
    <div className={`turn-timer ${secs <= 5 ? 'turn-timer--low' : ''}`} role="timer" aria-label={`${secs} seconds left`}>
      <div className="turn-timer__bar" style={{ width: `${pct}%` }} />
      <span className="turn-timer__text">{secs}s</span>
    </div>
  );
}
