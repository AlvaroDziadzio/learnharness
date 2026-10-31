/**
 * Study-time contracts: the stored interval, the open-timer file, the
 * request/result shapes and the history summary the overlay renders.
 * Timestamps are Date.prototype.toISOString() strings.
 */

/** One finished span of study time (a line of intervals.jsonl): for one
 *  chat (`chatId`), or flashcard review (`source: "review"`, no chatId —
 *  docs/designs/flashcards.md, D7). Exactly one of the two is set. */
export interface StudyInterval {
	v: 1;
	chatId?: string;
	source?: "review";
	start: string;
	end: string;
	/** Diagnostics only: "stop" = a stop request, "shutdown" = the server's
	 *  shutdown listener, "idle" = closed at its last ping. */
	endReason: "stop" | "idle" | "shutdown";
}

/** The open.json key of the flashcard review timer. Chat ids match
 *  [A-Za-z0-9_-]+, so it cannot collide with one. */
export const REVIEW_TIMER_KEY = "@review";

/** open.json: working state, not history. Keyed by chat id or REVIEW_TIMER_KEY. */
export interface OpenStudyTimers {
	v: 1;
	timers: Record<string, { start: string; lastPing: string; windowId: string }>;
}

export const STUDY_RANGE_KEYS = ["week", "month", "last7", "last30", "all"] as const;
export type StudyRangeKey = (typeof STUDY_RANGE_KEYS)[number];

export type StudyInput =
	| { type: "active" | "stop"; chatId: string; windowId: string }
	| { type: "active" | "stop"; source: "review"; windowId: string }
	| { type: "closeAll" };

export type StudyResult =
	| { ok: true }
	| { ok: false; status: 400 | 404; error: "chat_not_started" | "chat_not_found" };

export interface StudySummary {
	cards: { todayMs: number; weekMs: number; totalMs: number };
	range: {
		key: StudyRangeKey;
		/** Largest first, ties by key; entries with no time in range left out.
		 *  Flashcard review is its own entry (`source: "review"`). */
		perChat: ({ chatId: string; ms: number } | { source: "review"; ms: number })[];
		/** Milliseconds per local hour (0 = 00:00–00:59), 24 entries. */
		hours: number[];
	};
	grid: {
		weekStart: "monday" | "sunday";
		/** Ascending date order. */
		days: { date: string; ms: number; level: 0 | 1 | 2 | 3 | 4 }[];
	};
	idleMinutes: number;
}

/** The return shape of every timer transition. */
export interface TimerStep {
	open: OpenStudyTimers;
	closed: StudyInterval[];
}
