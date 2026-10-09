import { BookOpen, Check, Copy, Crown, DoorOpen, Eye, Play } from 'lucide-react';
import { useState } from 'react';
import type { PublicPlayer, Seat } from '@shared/types';
import { Avatar } from '../components/Avatar';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { SettingsForm } from '../components/SettingsForm';
import { positionOf, TEAM_NAME } from '../game/labels';
import type { GameSocketApi } from '../game/useGameSocket';

const STATUS_LABEL: Record<string, string> = {
  empty: 'EMPTY',
  connected: 'NOT READY',
  ready: 'READY',
  disconnected: 'DISCONNECTED',
  vacant: 'LEFT',
};

export function Lobby({ api, onShowRules }: { api: GameSocketApi; onShowRules: () => void }) {
  const room = api.room!;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const me = room.mySeat !== null ? room.seats[room.mySeat] : null;
  const seated = room.seats.filter(Boolean) as PublicPlayer[];
  const allReady = seated.length === 4 && seated.every((p) => p.ready && p.connected);
  const inviteLink = `${window.location.origin}${window.location.pathname}?room=${room.code}`;

  const copy = async (text: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      api.toast('info', text);
    }
  };

  const startHint = seated.length < 4 ? `Waiting for ${4 - seated.length} more player${seated.length === 3 ? '' : 's'}…` : !allReady ? 'Waiting for everyone to be ready…' : 'Everyone is ready!';

  return (
    <div className="screen lobby">
      <header className="topbar">
        <span className="logo logo--small">
          <span className="logo__num">29</span> ROYALE
        </span>
        <span className="topbar__spacer" />
        <button type="button" className="icon-btn" onClick={onShowRules} aria-label="Rules">
          <BookOpen size={18} />
        </button>
        <ConnectionBadge state={api.connection} />
      </header>

      <div className="lobby__grid">
        <section className="pixel-panel lobby__invite">
          <h2 className="pixel-heading">ROOM CODE</h2>
          <button type="button" className="room-code" onClick={() => copy(room.code, 'code')} title="Copy room code">
            {room.code}
          </button>
          <div className="lobby__invite-actions">
            <button type="button" className="btn btn--small" onClick={() => copy(inviteLink, 'link')}>
              {copied === 'link' ? <Check size={14} /> : <Copy size={14} />} {copied === 'link' ? 'COPIED!' : 'COPY INVITE LINK'}
            </button>
          </div>
          <p className="muted">Share the code or link with three friends. Partners sit opposite each other.</p>
          {room.spectatorCount > 0 && (
            <p className="muted">
              <Eye size={14} /> {room.spectatorCount} watching
            </p>
          )}
        </section>

        <section className="pixel-panel lobby__table-panel">
          <h2 className="pixel-heading">SEATS</h2>
          <div className="mini-table">
            <div className="mini-table__felt">
              <span className="mini-table__label">29</span>
            </div>
            {([0, 1, 2, 3] as Seat[]).map((seat) => {
              const p = room.seats[seat];
              const pos = positionOf(seat, room.mySeat);
              const team = (seat % 2) as 0 | 1;
              const canSit = !p && !room.isSpectator;
              return (
                <div key={seat} className={`lobby-seat lobby-seat--${pos} team-${team} ${p?.seat === room.mySeat ? 'lobby-seat--me' : ''}`}>
                  {p ? (
                    <>
                      <Avatar name={p.nickname} team={team} size={40} />
                      <span className="lobby-seat__name">
                        {p.isHost && <Crown size={12} className="gold" aria-label="Host" />} {p.nickname}
                        {p.seat === room.mySeat && ' (you)'}
                      </span>
                      <span className={`status-chip status-chip--${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    </>
                  ) : (
                    <>
                      <span className="lobby-seat__empty">EMPTY</span>
                      {canSit && (
                        <button type="button" className="btn btn--tiny" onClick={() => api.actions.switchSeat(seat)}>
                          SIT HERE
                        </button>
                      )}
                    </>
                  )}
                  <span className="lobby-seat__team">TEAM {TEAM_NAME[team].toUpperCase()}</span>
                </div>
              );
            })}
          </div>
          <div className="lobby__actions">
            {me && (
              <button type="button" className={`btn ${me.ready ? 'btn--green' : 'btn--gold'}`} onClick={() => api.actions.setReady(!me.ready)}>
                <Check size={16} /> {me.ready ? 'READY!' : 'READY UP'}
              </button>
            )}
            {room.isHost && (
              <button type="button" className="btn btn--gold" disabled={!allReady} onClick={() => api.actions.startGame()}>
                <Play size={16} /> START MATCH
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => api.actions.leaveRoom()}>
              <DoorOpen size={16} /> LEAVE
            </button>
          </div>
          <p className="muted center" role="status">
            {room.isHost ? startHint : allReady ? 'Waiting for the host to start…' : startHint}
          </p>
        </section>

        <section className="pixel-panel lobby__settings">
          <h2 className="pixel-heading">RULES</h2>
          <SettingsForm value={room.settings} onChange={(patch) => api.actions.updateSettings(patch)} disabled={!room.isHost} />
          {!room.isHost && <p className="muted">Only the host can change the rules.</p>}
          <ul className="rules-summary">
            <li>
              Bids {room.ruleset.minBid}–{room.ruleset.maxBid} · {room.settings.biddingStyle === 'duel' ? 'duel bidding (stay allowed)' : 'open bidding'}
            </li>
            <li>{room.ruleset.trumpConcealed ? 'Hidden trump, revealed on demand' : 'Trump announced openly'}</li>
            <li>{room.ruleset.pairEnabled ? 'Pair (K+Q of trump) ±4' : 'No pair'}</li>
            <li>
              Reverse Trump: {room.settings.reverseTrumpEnabled ? (room.ruleset.reverseTrumpScope === 'allSuits' ? 'ON (all suits)' : 'ON (trump suit)') : 'OFF'}
            </li>
            <li>First to +{room.ruleset.targetScore} wins</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
