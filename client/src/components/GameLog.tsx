import { useEffect, useRef } from 'react';
import type { LogEntry } from '@shared/types';

export function GameLog({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);
  return (
    <section className="pixel-panel game-log" aria-label="Game log">
      <h3 className="pixel-heading pixel-heading--sm">LOG</h3>
      <ol ref={ref}>
        {log.map((e) => (
          <li key={e.id} className={`log--${e.kind}`}>
            {e.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
