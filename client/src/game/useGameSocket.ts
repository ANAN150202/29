import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ActionError,
  ClientToServerEvents,
  JoinResult,
  ServerToClientEvents,
} from '@shared/events';
import type { GameView, RoomSettings, RoomView, Seat, Suit, TrickRecord } from '@shared/types';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface Toast {
  id: number;
  kind: 'error' | 'info' | 'success';
  text: string;
}

interface StoredSession {
  roomCode: string;
  token: string;
}

const SESSION_KEY = 'royale:session';
const NICK_KEY = 'royale:nickname';

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}
function saveSession(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — reconnection just won't survive a refresh */
  }
}
export function loadNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveNickname(n: string) {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {
    /* ignore */
  }
}

/** Random id that also works on plain-http LAN addresses (no crypto.randomUUID). */
function newActionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function useGameSocket() {
  const socketRef = useRef<GameSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<GameView | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastResolved, setLastResolved] = useState<TrickRecord | null>(null);
  const [rejoining, setRejoining] = useState<boolean>(() => !!loadSession());
  const roomRef = useRef<RoomView | null>(null);
  const gameRef = useRef<GameView | null>(null);
  const toastId = useRef(0);
  roomRef.current = room;
  gameRef.current = game;

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 4500 : 3000);
  }, []);

  const clearRoom = useCallback(() => {
    saveSession(null);
    setRoom(null);
    setGame(null);
  }, []);

  useEffect(() => {
    const url = import.meta.env.VITE_SERVER_URL as string | undefined;
    const socket: GameSocket = url
      ? io(url, { transports: ['websocket', 'polling'] })
      : io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const rejoin = () => {
      const session = loadSession();
      if (!session) {
        setRejoining(false);
        return;
      }
      setRejoining(true);
      socket.emit(
        'room:join',
        { roomCode: session.roomCode, nickname: loadNickname() || 'Player', sessionToken: session.token },
        (res) => {
          setRejoining(false);
          if (res.ok) {
            setRoom(res.data.room);
            saveSession({ roomCode: res.data.room.code, token: res.data.sessionToken });
          } else {
            clearRoom();
            if (res.error.code !== 'ROOM_NOT_FOUND') toast('error', res.error.message);
          }
        },
      );
    };

    socket.on('connect', () => {
      setConnection('connected');
      rejoin();
    });
    socket.on('disconnect', () => setConnection('reconnecting'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection(socket.active ? 'reconnecting' : 'offline'));

    socket.on('room:created', (r) => setRoom(r));
    socket.on('room:updated', (r) => {
      setRoom(r);
      if (r.status === 'lobby') setGame(null);
    });
    socket.on('room:closed', ({ reason, evicted }) => {
      if (evicted) {
        // Another tab now owns this seat and shares our stored session — keep it.
        setRoom(null);
        setGame(null);
      } else clearRoom();
      toast('info', reason);
    });
    socket.on('game:state', (s) => setGame(s));
    socket.on('game:trickResolved', ({ trick }) => setLastResolved(trick));
    socket.on('game:actionRejected', ({ error }) => {
      if (error.code !== 'STALE_ACTION') toast('error', error.message);
    });
    socket.on('player:disconnected', ({ nickname }) => toast('info', `${nickname} disconnected — waiting for them to return…`));
    socket.on('player:reconnected', ({ nickname }) => toast('success', `${nickname} is back!`));

    return () => {
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
    };
  }, [clearRoom, toast]);

  /** Emit with an ack, surfacing errors as toasts. */
  const call = useCallback(
    <T,>(event: keyof ClientToServerEvents, payload: unknown, quiet = false): Promise<Ack<T>> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          const error: ActionError = { code: 'INTERNAL_ERROR', message: 'Not connected to the server.' };
          if (!quiet) toast('error', error.message);
          resolve({ ok: false, error });
          return;
        }
        (socket.emit as (e: string, p: unknown, cb: (r: Ack<T>) => void) => void)(event, payload, (res) => {
          if (!res.ok && !quiet && res.error.code !== 'STALE_ACTION') toast('error', res.error.message);
          resolve(res);
        });
      }),
    [toast],
  );

  const onJoined = useCallback((res: Ack<JoinResult>, nickname: string) => {
    if (res.ok) {
      saveNickname(nickname);
      saveSession({ roomCode: res.data.room.code, token: res.data.sessionToken });
      setRoom(res.data.room);
      if (res.data.room.status === 'lobby') setGame(null);
    }
    return res;
  }, []);

  const gameAction = useCallback(
    (event: keyof ClientToServerEvents, extra: Record<string, unknown> = {}) => {
      const r = roomRef.current;
      const g = gameRef.current;
      if (!r || !g) return Promise.resolve({ ok: false } as Ack);
      return call(event, { roomCode: r.code, actionId: newActionId(), seq: g.seq, ...extra });
    },
    [call],
  );

  const actions = useMemo(
    () => ({
      createRoom: async (nickname: string, settings: Partial<RoomSettings>) =>
        onJoined(await call<JoinResult>('room:create', { nickname, settings }), nickname),
      playVsComputer: async (nickname: string, settings: Partial<RoomSettings>) =>
        onJoined(await call<JoinResult>('room:playVsComputer', { nickname, settings }), nickname),
      addBot: (seat?: Seat) => call('room:addBot', { roomCode: roomRef.current!.code, seat }),
      removeBot: (seat: Seat) => call('room:removeBot', { roomCode: roomRef.current!.code, seat }),
      joinRoom: async (roomCode: string, nickname: string, asSpectator = false) =>
        onJoined(await call<JoinResult>('room:join', { roomCode: roomCode.toUpperCase(), nickname, asSpectator }), nickname),
      leaveRoom: async () => {
        const r = roomRef.current;
        if (r) await call('room:leave', { roomCode: r.code }, true);
        clearRoom();
      },
      setReady: (ready: boolean) => call('room:ready', { roomCode: roomRef.current!.code, ready }),
      switchSeat: (seat: Seat) => call('room:switchSeat', { roomCode: roomRef.current!.code, seat }),
      updateSettings: (settings: Partial<RoomSettings>) =>
        call('room:updateSettings', { roomCode: roomRef.current!.code, settings }),
      startGame: () => call('game:start', { roomCode: roomRef.current!.code }),
      backToLobby: () => call('room:backToLobby', { roomCode: roomRef.current!.code }),
      bid: (amount: number) => gameAction('game:bid', { amount }),
      pass: () => gameAction('game:pass'),
      chooseTrump: (suit: Suit, reverse: boolean) => gameAction('game:chooseTrump', { suit, reverse }),
      revealTrump: () => gameAction('game:revealTrump'),
      declarePair: () => gameAction('game:declarePair'),
      playCard: (cardId: string) => gameAction('game:playCard', { cardId }),
      nextRound: () => gameAction('game:nextRound'),
      rematch: () => gameAction('game:rematch'),
    }),
    [call, clearRoom, gameAction, onJoined],
  );

  return { connection, room, game, toasts, toast, lastResolved, rejoining, actions };
}

export type GameSocketApi = ReturnType<typeof useGameSocket>;
