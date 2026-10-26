// The debugger's record of every turn the chat runs in this page (bridge design §13): the component's run observer
// (chat property `run-observer`) — each turn's request as sent, every SSE `data:` payload verbatim with its arrival time,
// the end — plus the breakpoints the next `/debug` runs carry (set by the agent's panel message, removable in the
// inspector). Client-only and in memory: the page's export (exporter.ts) is the way to keep it.
import type { RunObserver, RunTurnSink, RunTurnStart } from "../../jet-composites/xxx-gnimsys-ai/chat/lib/debug/RunObserver";

export interface RecordedFrame { payload: string; at: number }

/** The definition version read right after the turn ended (the version the run most likely executed). */
export type TurnDefinitionVersion = { version?: string } | { error: string };

export interface RecordedTurn {
  /** 1-based, in the order the turns were sent in this page. */
  seq: number;
  conversationId: string;
  endpoint: RunTurnStart["endpoint"];
  path: string;
  /** The request body as sent. */
  request: Record<string, unknown>;
  sentAt: number;
  frames: RecordedFrame[];
  endedAt?: number;
  error?: { message: string; status?: number };
  definitionVersion?: TurnDefinitionVersion;
}

const NODE_CODE = /^[A-Za-z0-9_]+$/;

export class RunStore implements RunObserver {
  private turnsList: RecordedTurn[] = [];
  private points: string[] = [];
  private nextSeq = 1;
  private rev = 0;
  private readonly listeners = new Set<() => void>();
  /** Called when a turn has ended (the page reads the definition version then). */
  onTurnEnd: ((turn: RecordedTurn) => void) | null = null;

  /** Bumped by every change (turns and their frames are appended in place). */
  get revision(): number {
    return this.rev;
  }

  get turns(): readonly RecordedTurn[] {
    return this.turnsList;
  }

  /** The breakpoints of the next `/debug` runs (node codes, in the order set). */
  get breakpoints(): readonly string[] {
    return this.points;
  }

  // ---- RunObserver (the chat calls these) ------------------------------------------------------

  breakPoints(): string[] {
    return [...this.points];
  }

  turn(start: RunTurnStart): RunTurnSink {
    const turn: RecordedTurn = {
      seq: this.nextSeq++, conversationId: start.conversationId, endpoint: start.endpoint, path: start.path,
      request: start.body, sentAt: start.at, frames: [],
    };
    this.turnsList = [...this.turnsList, turn];
    this.changed();
    let ended = false;
    return {
      frame: (payload, at) => {
        if (ended || !this.turnsList.includes(turn)) return; // cleared meanwhile (reset)
        turn.frames.push({ payload, at });
        this.changed();
      },
      end: (info) => {
        if (ended) return;
        ended = true;
        if (!this.turnsList.includes(turn)) return;
        turn.endedAt = info.at;
        if (info.error !== undefined) turn.error = info.error;
        this.changed();
        this.onTurnEnd?.(turn);
      },
    };
  }

  // ---- the page's own operations ---------------------------------------------------------------

  /** Replaces the breakpoints; every entry must be a node code, no duplicates (else throws, nothing changes). */
  setBreakpoints(codes: readonly string[]): void {
    const bad = codes.filter((c) => !NODE_CODE.test(c));
    if (bad.length > 0) throw new Error(`not node codes: ${bad.join(", ")}`);
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length > 0) throw new Error(`given twice: ${[...new Set(dup)].join(", ")}`);
    this.points = [...codes];
    this.changed();
  }

  removeBreakpoint(code: string): void {
    this.points = this.points.filter((c) => c !== code);
    this.changed();
  }

  /** Records the definition version read after a turn. */
  setDefinitionVersion(turn: RecordedTurn, v: TurnDefinitionVersion): void {
    if (!this.turnsList.includes(turn)) return;
    turn.definitionVersion = v;
    this.changed();
  }

  /** Forgets every recorded turn (a reset to a fresh pod conversation); the breakpoints stay. */
  clear(): void {
    this.turnsList = [];
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void {
    this.rev++;
    for (const l of [...this.listeners]) l();
  }
}
