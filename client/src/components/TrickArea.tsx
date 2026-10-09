import { useEffect, useState } from 'react';
import type { GameView, PublicPlayer } from '@shared/types';
import { positionOf } from '../game/labels';
import { Card } from './Card';

/** The four cards of the current trick, placed toward each player's seat. */
export function TrickArea({ game, seats }: { game: GameView; seats: (PublicPlayer | null)[] }) {
  const resolving = game.phase === 'trickResolution' && game.trickWinner !== null;
  const [collecting, setCollecting] = useState(false);
  useEffect(() => {
    setCollecting(false);
    if (!resolving) return;
    const t = setTimeout(() => setCollecting(true), 750);
    return () => clearTimeout(t);
  }, [resolving, game.seq]);

  const winnerPos = game.trickWinner !== null ? positionOf(game.trickWinner, game.mySeat) : null;

  return (
    <div className={`trick ${collecting && winnerPos ? `trick--collect-${winnerPos}` : ''}`} aria-label="Current trick">
      {game.currentTrick.cards.map((pc, i) => {
        const pos = positionOf(pc.seat, game.mySeat);
        const winning = resolving && pc.seat === game.trickWinner;
        return (
          <div key={pc.card.id} className={`trick__slot trick__slot--${pos} ${winning ? 'is-winner' : ''}`} style={{ zIndex: i + 1 }}>
            <Card card={pc.card} size="md" highlight={winning} className={`played-from-${pos}`} />
          </div>
        );
      })}
      {resolving && winnerPos && (
        <div className="trick__banner" role="status">
          {seats[game.trickWinner!]?.nickname ?? 'Player'} takes it!
        </div>
      )}
      {game.phase === 'playing' && game.currentTrick.cards.length === 0 && (
        <div className="trick__hint">TRICK {game.tricksPlayed + 1} / 8</div>
      )}
    </div>
  );
}
