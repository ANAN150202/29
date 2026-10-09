import { Crown, WifiOff, Bot, Cpu } from 'lucide-react';
import type { GameView, PublicPlayer, Seat } from '@shared/types';
import type { Position } from '../game/labels';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { TurnTimer } from './TurnTimer';

export function PlayerSeat({
  seat,
  player,
  position,
  game,
  isMe,
}: {
  seat: Seat;
  player: PublicPlayer | null;
  position: Position;
  game: GameView;
  isMe: boolean;
}) {
  const team = (seat % 2) as 0 | 1;
  const isTurn = game.turn === seat && ['bidding', 'trumpSelection', 'playing'].includes(game.phase);
  const count = game.handCounts[seat] ?? 0;
  const lastBid = [...game.bidding.history].reverse().find((b) => b.seat === seat);
  const isBidder = game.contract?.bidder === seat;
  const name = player?.nickname ?? 'Empty';

  return (
    <div className={`seat seat--${position} team-${team} ${isTurn ? 'seat--turn' : ''} ${isMe ? 'seat--me' : ''}`}>
      <div className="seat__plate">
        <Avatar name={name} team={team} size={isMe ? 30 : 34} />
        <div className="seat__info">
          <span className="seat__name">
            {player?.isHost && <Crown size={11} className="gold" aria-label="Host" />}
            {name}
            {isMe && <span className="seat__you"> (you)</span>}
          </span>
          <span className="seat__badges">
            <span className={`team-dot team-dot--${team}`} aria-label={team === 0 ? 'Team Red' : 'Team Blue'} />
            {player?.isBot && (
              <span className="badge" title="Computer player">
                <Cpu size={10} /> CPU
              </span>
            )}
            {game.dealer === seat && <span className="badge">DEAL</span>}
            {isBidder && (
              <span className="badge badge--gold">
                BID {game.contract!.target}
                {(game.contract!.multiplier ?? 1) > 1 && ` ×${game.contract!.multiplier}`}
              </span>
            )}
            {game.single.declarer === seat && <span className="badge badge--single">SINGLE</span>}
            {game.single.declarer !== null && (game.single.declarer + 2) % 4 === seat && <span className="badge badge--muted">SITS OUT</span>}
            {game.phase === 'bidding' && lastBid && (
              <span className={`badge ${lastBid.bid === null ? 'badge--muted' : ''}`}>{lastBid.bid === null ? 'PASS' : lastBid.stay ? `STAY ${lastBid.bid}` : lastBid.bid}</span>
            )}
            {player && !player.connected && !player.vacated && (
              <span className="badge badge--warn" title="Disconnected">
                <WifiOff size={10} />
              </span>
            )}
            {player?.vacated && (
              <span className="badge badge--warn" title="Seat is auto-played">
                <Bot size={10} /> AUTO
              </span>
            )}
          </span>
        </div>
      </div>
      {isTurn && <TurnTimer leftMs={game.turnTimeLeftMs} totalMs={game.turnTimeLimitMs} resetKey={game.seq} />}
      {!isMe && count > 0 && (
        <div className="seat__hand" aria-label={`${count} cards`}>
          {Array.from({ length: count }, (_, i) => (
            <Card key={i} faceDown size="sm" className="seat__back" style={{ ['--i' as string]: i }} />
          ))}
          <span className="seat__count">{count}</span>
        </div>
      )}
    </div>
  );
}
