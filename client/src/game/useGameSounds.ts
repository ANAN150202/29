import { useEffect, useRef } from 'react';
import type { GameView, RoomView, TrickRecord } from '@shared/types';
import { sfx, unlockAudio } from './sound';
import type { Toast } from './useGameSocket';

const BUTTON_SELECTOR = '.btn, .icon-btn, .suit-btn, .mode-btn, .room-code, .toggle';

/**
 * Plays retro sound effects by diffing successive server states, so every
 * player hears the same events (bids, card plays, trick wins…) no matter who acted.
 */
export function useGameSounds(room: RoomView | null, game: GameView | null, lastResolved: TrickRecord | null, toasts: Toast[]) {
  // Unlock audio on the first user gesture, and give every button a click blip.
  useEffect(() => {
    const onDown = () => unlockAudio();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest(BUTTON_SELECTOR);
      if (el && !(el as HTMLButtonElement).disabled && !el.classList.contains('no-click-sound')) sfx.click();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('click', onClick, true);
    };
  }, []);

  // ── lobby: joins, leaves, ready ─────────────────────────────────────
  const prevRoom = useRef<RoomView | null>(null);
  useEffect(() => {
    const prev = prevRoom.current;
    prevRoom.current = room;
    if (!prev || !room || prev.code !== room.code) return;
    const count = (r: RoomView) => r.seats.filter((p) => p && p.connected).length;
    const readyCount = (r: RoomView) => r.seats.filter((p) => p && p.ready).length;
    if (room.status === 'inGame' && prev.status === 'lobby') return; // match start handled below
    if (count(room) > count(prev)) sfx.join();
    else if (count(room) < count(prev)) sfx.leave();
    else if (room.status === 'lobby' && readyCount(room) > readyCount(prev)) sfx.ready();
  }, [room]);

  // ── game state diffs ────────────────────────────────────────────────
  const prevGame = useRef<GameView | null>(null);
  useEffect(() => {
    const prev = prevGame.current;
    prevGame.current = game;
    if (!game) return;
    if (!prev) {
      if (game.phase === 'bidding' && game.round === 1 && game.bidding.history.length === 0) {
        sfx.start();
        setTimeout(sfx.deal, 350);
      }
      return;
    }
    const me = game.mySeat;
    const myTeam = me === null ? null : me % 2;

    // New round dealt.
    if (game.round !== prev.round || (game.phase === 'bidding' && prev.phase !== 'bidding')) {
      sfx.deal();
      return;
    }

    // Bidding actions.
    if (game.bidding.history.length > prev.bidding.history.length) {
      const last = game.bidding.history[game.bidding.history.length - 1];
      if (last.bid === null) sfx.pass();
      else if (last.stay) sfx.stay();
      else sfx.bid();
    }
    if (game.phase === 'trumpSelection' && prev.phase === 'bidding') setTimeout(sfx.bidWon, 180);

    // Trump chosen.
    if (prev.phase === 'trumpSelection' && game.phase !== 'trumpSelection') sfx.trumpChosen();
    // Last four cards dealt.
    if (game.myHand.length === 8 && prev.myHand.length === 4) setTimeout(sfx.deal, 250);

    // Trump revealed during play.
    if (game.trump.revealed && !prev.trump.revealed && game.phase === 'playing' && prev.phase === 'playing') {
      if (game.trump.reverse) sfx.reverseReveal();
      else sfx.trumpReveal();
    }

    // Double / Redouble / Set.
    if (game.doubling.calls.length > prev.doubling.calls.length) {
      const call = game.doubling.calls[game.doubling.calls.length - 1].call;
      sfx[call]();
    }
    // Single Hand declared.
    if (game.single.declarer !== null && prev.single.declarer === null) sfx.single();
    // A decision window just opened for me.
    const myWindow = (g: GameView) => g.doubling.canCall || (me !== null && g.phase === 'singleHand' && g.single.pending.includes(me));
    if (myWindow(game) && !myWindow(prev)) setTimeout(sfx.yourTurn, 250);

    // Pair declared.
    if (game.pair && !prev.pair) sfx.pair();

    // A card hit the table.
    if (game.currentTrick.cards.length > prev.currentTrick.cards.length) sfx.cardPlay();

    // Round / match over.
    if (game.roundResult && game.roundResult !== prev.roundResult && game.roundResult.round !== prev.roundResult?.round) {
      if (game.phase === 'matchEnd') {
        setTimeout(() => (myTeam === null || game.matchWinner === myTeam ? sfx.victory() : sfx.defeat()), 300);
      } else {
        const r = game.roundResult;
        const winningTeam = r.success ? r.contract.team : 1 - r.contract.team;
        setTimeout(() => (myTeam === null || winningTeam === myTeam ? sfx.roundWon() : sfx.roundLost()), 300);
      }
    }

    // Your turn (bidding, trump choice or play).
    const active = ['bidding', 'trumpSelection', 'playing'];
    if (me !== null && game.turn === me && active.includes(game.phase) && (prev.turn !== me || !active.includes(prev.phase))) {
      setTimeout(sfx.yourTurn, 220);
    }
  }, [game]);

  // Trick collected.
  const prevTrick = useRef<TrickRecord | null>(null);
  useEffect(() => {
    if (!lastResolved || lastResolved === prevTrick.current) return;
    prevTrick.current = lastResolved;
    const me = prevGame.current?.mySeat ?? null;
    if (me === null || lastResolved.winner % 2 === me % 2) sfx.trickWon();
    else sfx.trickLost();
  }, [lastResolved]);

  // Errors.
  const seenToast = useRef(0);
  useEffect(() => {
    const fresh = toasts.filter((t) => t.id > seenToast.current);
    if (!fresh.length) return;
    seenToast.current = Math.max(...fresh.map((t) => t.id));
    if (fresh.some((t) => t.kind === 'error')) sfx.error();
  }, [toasts]);
}
