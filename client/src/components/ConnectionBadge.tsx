import { Wifi, WifiOff } from 'lucide-react';
import type { ConnectionState } from '../game/useGameSocket';

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const ok = state === 'connected';
  return (
    <span className={`conn conn--${state}`} title={ok ? 'Connected' : state === 'offline' ? 'Offline' : 'Reconnecting'}>
      {ok ? <Wifi size={14} aria-hidden /> : <WifiOff size={14} aria-hidden />}
      <span className="sr-only">{state}</span>
    </span>
  );
}
