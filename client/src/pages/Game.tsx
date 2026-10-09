import { BookOpen, DoorOpen, Eye, Hand, Heart, Megaphone, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Card as CardT, Rank, Seat, Suit } from '@shared/types';
import { BiddingPanel } from '../components/BiddingPanel';
import { Card } from '../components/Card';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { GameLog } from '../components/GameLog';
import { PlayerSeat } from '../components/PlayerSeat';
import { ResultsPanel } from '../components/ResultsPanel';
import { Scoreboard } from '../components/Scoreboard';
import { TrickArea } from '../components/TrickArea';
import { TrumpIndicator } from '../components/TrumpIndicator';
import { TrumpSelector } from '../components/TrumpSelector';
import { TurnTimer } from '../components/TurnTimer';
import { positionOf, SUIT_NAME } from '../game/labels';
import type { GameSocketApi } from '../game/useGameSocket';

// Display-only ordering for the local hand (the server decides all card strength).
const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const RANK_ORDER: Rank[] = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const sortHand = (cards: CardT[]) =>
  cards
    .slice()
    .sort((a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank));

export function Game({ api, onShowRules }: { api: GameSocketApi; onShowRules: () => void }) {
  const room = api.room!;
  const game = api.game!;
  const { actions } = api;
  const [selected, setSelected] = useState<string | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [showLastTrick, setShowLastTrick] = useState(false);

  const mySeat = game.mySeat;
  const myTurn = mySeat !== null && game.turn === mySeat;
  const legal = useMemo(() => new Set(game.legalCardIds), [game.legalCardIds]);
  const hand = useMemo(() => sortHand(game.myHand), [game.myHand]);
  const roundOver = game.phase === 'roundEnd' || game.phase === 'matchEnd';

  useEffect(() => {
    if (selected && !legal.has(selected)) setSelected(null);
  }, [legal, selected]);
  useEffect(() => {
    if (!roundOver) setResultsHidden(false);
  }, [roundOver]);

  const onCardClick = (id: string) => {
    if (!myTurn || game.phase !== 'playing' || !legal.has(id)) return;
    if (selected === id) {
      setSelected(null);
      actions.playCard(id);
    } else setSelected(id);
  };

  const turnName = game.turn !== null ? room.seats[game.turn]?.nickname : null;
  const leadSuit = game.currentTrick.leadSuit;

  let status: string;
  if (game.phase === 'playing') {
    if (myTurn) {
      status = game.mustPlayTrump
        ? 'You called for trump — play a trump card!'
        : leadSuit && game.legalCardIds.every((id) => id.startsWith(leadSuit))
          ? `Your turn — follow ${SUIT_NAME[leadSuit]}.`
          : 'Your turn — play any card.';
    } else status = `Waiting for ${turnName}…`;
  } else if (game.phase === 'trickResolution') status = 'Collecting the trick…';
  else if (roundOver) status = game.phase === 'matchEnd' ? 'Match over!' : 'Round over.';
  else status = '';

  const confirmLeave = () => {
    if (window.confirm('Leave the match? Your seat will be auto-played until someone takes it.')) actions.leaveRoom();
  };

  return (
    <div className={`screen game ${myTurn ? 'game--my-turn' : ''}`}>
      <header className="topbar">
        <span className="logo logo--small">
          <span className="logo__num">29</span>
          <span className="hide-sm"> ROYALE</span>
        </span>
        <span className="topbar__room" title="Room code">
          {room.code}
        </span>
        <span className="topbar__round">R{game.round}</span>
        <TrumpIndicator game={game} />
        <span className="topbar__spacer" />
        <button type="button" className="icon-btn" onClick={onShowRules} aria-label="Rules">
          <BookOpen size={18} />
        </button>
        <button type="button" className="icon-btn" onClick={confirmLeave} aria-label="Leave room">
          <DoorOpen size={18} />
        </button>
        <ConnectionBadge state={api.connection} />
      </header>

      <main className="table-wrap">
        <div className="table">
          <div className="felt">
            {([0, 1, 2, 3] as Seat[]).map((seat) => (
              <PlayerSeat
                key={seat}
                seat={seat}
                player={room.seats[seat]}
                position={positionOf(seat, mySeat)}
                game={game}
                isMe={seat === mySeat}
              />
            ))}
            <TrickArea game={game} seats={room.seats} />
          </div>
        </div>
      </main>

      <section className="dock" aria-label="Actions">
        {game.phase === 'bidding' && <BiddingPanel game={game} seats={room.seats} actions={actions} />}
        {game.phase === 'trumpSelection' && <TrumpSelector game={game} seats={room.seats} actions={actions} />}
        {(game.phase === 'playing' || game.phase === 'trickResolution' || roundOver) && (
          <div className={`action-panel play-status ${myTurn ? 'is-my-turn' : ''}`}>
            <p className="play-status__text" role="status">
              {myTurn && <Hand size={16} className="gold" aria-hidden />} {status}
            </p>
            {myTurn && <TurnTimer leftMs={game.turnTimeLeftMs} totalMs={game.turnTimeLimitMs} resetKey={game.seq} />}
            <div className="play-status__buttons">
              {game.canRevealTrump && (
                <button type="button" className="btn btn--gold" onClick={() => actions.revealTrump()}>
                  <Megaphone size={16} /> CALL FOR TRUMP
                </button>
              )}
              {game.canDeclarePair && (
                <button type="button" className="btn btn--green" onClick={() => actions.declarePair()}>
                  <Heart size={16} /> DECLARE PAIR
                </button>
              )}
              {selected && myTurn && game.phase === 'playing' && (
                <button type="button" className="btn btn--gold" onClick={() => onCardClick(selected)}>
                  PLAY CARD
                </button>
              )}
              {roundOver && resultsHidden && (
                <button type="button" className="btn" onClick={() => setResultsHidden(false)}>
                  <Trophy size={16} /> SHOW RESULTS
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={`hand ${hand.length > 6 ? 'hand--full' : ''}`} aria-label="Your hand">
        {mySeat === null ? (
          <p className="muted center">You are watching this match.</p>
        ) : (
          hand.map((card, i) => {
            const playable = myTurn && game.phase === 'playing' && legal.has(card.id);
            const dim = myTurn && game.phase === 'playing' && !legal.has(card.id);
            return (
              <Card
                key={`${game.round}-${card.id}`}
                card={card}
                size="lg"
                playable={playable}
                disabled={dim}
                selected={selected === card.id}
                onClick={() => onCardClick(card.id)}
                className="hand__card deal-in"
                style={{ ['--i' as string]: i }}
              />
            );
          })
        )}
      </section>

      <aside className="side">
        <Scoreboard game={game} seats={room.seats} />
        {game.lastTrick && (
          <section className="pixel-panel last-trick">
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setShowLastTrick((v) => !v)} aria-expanded={showLastTrick}>
              <Eye size={14} /> LAST TRICK ({room.seats[game.lastTrick.winner]?.nickname}, {game.lastTrick.points} pts)
            </button>
            {showLastTrick && (
              <div className="last-trick__cards">
                {game.lastTrick.cards.map((pc) => (
                  <div key={pc.card.id} className="last-trick__item">
                    <Card card={pc.card} size="sm" highlight={pc.seat === game.lastTrick!.winner} />
                    <small>{room.seats[pc.seat]?.nickname}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <GameLog log={game.log} />
      </aside>

      {roundOver && !resultsHidden && (
        <ResultsPanel game={game} seats={room.seats} isHost={room.isHost} actions={actions} onHide={() => setResultsHidden(true)} />
      )}
    </div>
  );
}
