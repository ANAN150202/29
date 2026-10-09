import type { Room } from './Room';

/**
 * Storage abstraction for rooms. The MVP keeps everything in memory, so a
 * server restart resets all active games. A Redis- or PostgreSQL-backed
 * implementation can be dropped in by implementing this interface (timers
 * held on Room would then move to a scheduler keyed by room code).
 */
export interface RoomStore {
  get(code: string): Room | undefined;
  has(code: string): boolean;
  set(room: Room): void;
  delete(code: string): void;
  values(): IterableIterator<Room>;
  size(): number;
}

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();
  get(code: string) {
    return this.rooms.get(code);
  }
  has(code: string) {
    return this.rooms.has(code);
  }
  set(room: Room) {
    this.rooms.set(room.code, room);
  }
  delete(code: string) {
    this.rooms.delete(code);
  }
  values() {
    return this.rooms.values();
  }
  size() {
    return this.rooms.size;
  }
}
