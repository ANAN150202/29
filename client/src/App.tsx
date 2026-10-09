import { useState } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import { RulesModal } from './components/RulesModal';
import { Toasts } from './components/Toasts';
import { useGameSocket } from './game/useGameSocket';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Lobby } from './pages/Lobby';

export function App() {
  const api = useGameSocket();
  const [rulesOpen, setRulesOpen] = useState(false);
  const { room, game, rejoining, connection } = api;

  let page: JSX.Element;
  if (!room) {
    page = rejoining ? (
      <div className="screen screen--center">
        <p className="pixel-heading blink">RECONNECTING…</p>
      </div>
    ) : (
      <Home api={api} onShowRules={() => setRulesOpen(true)} />
    );
  } else if (room.status === 'lobby' || !game) {
    page = <Lobby api={api} onShowRules={() => setRulesOpen(true)} />;
  } else {
    page = <Game api={api} onShowRules={() => setRulesOpen(true)} />;
  }

  return (
    <div className="app">
      {page}
      {connection !== 'connected' && (
        <div className="connection-banner" role="status">
          <ConnectionBadge state={connection} /> {connection === 'offline' ? 'Cannot reach the server.' : 'Reconnecting to the server…'}
        </div>
      )}
      <Toasts toasts={api.toasts} />
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
