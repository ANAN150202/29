import { BookOpen, LogIn, Plus } from 'lucide-react';
import { useState } from 'react';
import type { RoomSettings } from '@shared/types';
import { Card } from '../components/Card';
import { MuteButton } from '../components/MuteButton';
import { SettingsForm } from '../components/SettingsForm';
import { loadNickname, type GameSocketApi } from '../game/useGameSocket';

const DEFAULTS: RoomSettings = { rulesetId: 'classic', reverseTrumpEnabled: true, allowSpectators: false, turnTimeLimitSec: 45, biddingStyle: 'duel' };

function inviteCodeFromUrl(): string {
  const p = new URLSearchParams(window.location.search);
  return (p.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function Home({ api, onShowRules }: { api: GameSocketApi; onShowRules: () => void }) {
  const invite = inviteCodeFromUrl();
  const [nickname, setNickname] = useState(loadNickname());
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>(invite ? 'join' : 'menu');
  const [code, setCode] = useState(invite);
  const [settings, setSettings] = useState<RoomSettings>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nickOk = nickname.trim().length > 0;

  const run = async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    if (!nickOk) {
      setError('Enter a nickname first.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.error?.message ?? 'Something went wrong.');
    else if (invite) window.history.replaceState(null, '', window.location.pathname);
  };

  return (
    <div className="screen home">
      <div className="home__mute">
        <MuteButton />
      </div>
      <div className="home__cards" aria-hidden>
        <Card card={{ id: 'a', suit: 'spades', rank: 'J' }} size="lg" className="home__card home__card--1" />
        <Card card={{ id: 'b', suit: 'hearts', rank: '9' }} size="lg" className="home__card home__card--2" />
        <Card card={{ id: 'c', suit: 'diamonds', rank: 'A' }} size="lg" className="home__card home__card--3" />
      </div>
      <header className="home__header">
        <h1 className="logo">
          <span className="logo__num">29</span>
          <span className="logo__word">ROYALE</span>
        </h1>
        <p className="home__subtitle">Your table. Your team. Your 29.</p>
      </header>

      <main className="pixel-panel home__panel">
        <label className="field">
          <span className="field__label">NICKNAME</span>
          <input
            value={nickname}
            maxLength={16}
            autoComplete="nickname"
            placeholder="e.g. TrumpKing"
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>

        {mode === 'menu' && (
          <div className="home__buttons">
            <button type="button" className="btn btn--gold" onClick={() => setMode('create')}>
              <Plus size={16} /> CREATE ROOM
            </button>
            <button type="button" className="btn" onClick={() => setMode('join')}>
              <LogIn size={16} /> JOIN ROOM
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form
            className="home__form"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.actions.createRoom(nickname.trim(), settings));
            }}
          >
            <SettingsForm value={settings} onChange={(p) => setSettings((s) => ({ ...s, ...p }))} />
            <div className="home__buttons">
              <button type="submit" className="btn btn--gold" disabled={busy}>
                <Plus size={16} /> CREATE
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode('menu')}>
                BACK
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form
            className="home__form"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.actions.joinRoom(code.trim(), nickname.trim()));
            }}
          >
            <label className="field">
              <span className="field__label">ROOM CODE</span>
              <input
                className="input--code"
                value={code}
                maxLength={8}
                placeholder="ABCDE"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            <div className="home__buttons">
              <button type="submit" className="btn btn--gold" disabled={busy || code.length < 4}>
                <LogIn size={16} /> JOIN
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || code.length < 4}
                onClick={() => run(() => api.actions.joinRoom(code.trim(), nickname.trim(), true))}
              >
                WATCH
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setMode('menu')}>
                BACK
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="btn btn--link" onClick={onShowRules}>
          <BookOpen size={16} /> RULES &amp; HOW TO PLAY
        </button>
      </main>
      <footer className="home__footer">No account needed · 4 players · 2 teams · 1 Reverse Trump</footer>
    </div>
  );
}
