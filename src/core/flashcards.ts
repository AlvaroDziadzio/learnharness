/**
 * Flashcards — the pure core (design: docs/designs/flashcards.md): the
 * FSRS scheduler with the agreed parameters, (de)serialization of ts-fsrs
 * cards and logs, the review queue, and input validation. No fs, no server.
 */

import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade, type ReviewLog } from "ts-fsrs";
import type {
	FlashcardEdit,
	FlashcardQueue,
	FlashcardRecord,
	FlashcardReview,
	FlashcardReviewInput,
	FsrsGrade,
	FsrsState,
	NewFlashcard,
	SerializedFsrsCard,
	SerializedReviewLog,
} from "./contracts/flashcards.ts";

/** FSRS-6 default weights; retention 0.9, fuzz on, the library's default
 *  learning steps, a 100-year cap. No per-user optimizer. */
export const FSRS_PARAMETERS = generatorParameters({
	request_retention: 0.9,
	maximum_interval: 36500,
	enable_fuzz: true,
	enable_short_term: true,
});

const scheduler = fsrs(FSRS_PARAMETERS);

export const FSRS_GRADES: readonly FsrsGrade[] = [1, 2, 3, 4];
/** The tool's and the editor's per-call card cap. */
export const MAX_TOOL_CARDS = 10;

// ─── (de)serialization ───────────────────────────────────────────────────────

function serializeCard(c: Card): SerializedFsrsCard {
	return {
		due: c.due.toISOString(),
		stability: c.stability,
		difficulty: c.difficulty,
		elapsed_days: c.elapsed_days,
		scheduled_days: c.scheduled_days,
		learning_steps: c.learning_steps,
		reps: c.reps,
		lapses: c.lapses,
		state: c.state as FsrsState,
		...(c.last_review ? { last_review: c.last_review.toISOString() } : {}),
	};
}

function deserializeCard(s: SerializedFsrsCard): Card {
	return {
		...s,
		due: new Date(s.due),
		last_review: s.last_review ? new Date(s.last_review) : undefined,
	};
}

function serializeLog(l: ReviewLog): SerializedReviewLog {
	return {
		rating: l.rating as FsrsGrade,
		state: l.state as FsrsState,
		due: l.due.toISOString(),
		stability: l.stability,
		difficulty: l.difficulty,
		elapsed_days: l.elapsed_days,
		last_elapsed_days: l.last_elapsed_days,
		scheduled_days: l.scheduled_days,
		learning_steps: l.learning_steps,
		review: l.review.toISOString(),
	};
}

// ─── scheduling ──────────────────────────────────────────────────────────────

export function newFsrsCard(now: Date): SerializedFsrsCard {
	return serializeCard(createEmptyCard(now));
}

export function rateCard(card: SerializedFsrsCard, grade: FsrsGrade, now: Date): { fsrs: SerializedFsrsCard; log: SerializedReviewLog } {
	const item = scheduler.next(deserializeCard(card), now, grade as Grade);
	return { fsrs: serializeCard(item.card), log: serializeLog(item.log) };
}

/** A compact interval label: "10m", "3h", "4d", "1.5mo", "2y". */
export function formatInterval(ms: number): string {
	const minutes = ms / 60_000;
	if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h`;
	const days = hours / 24;
	if (days < 30) return `${Math.round(days)}d`;
	const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);
	if (days < 365) return `${oneDecimal(days / 30)}mo`;
	return `${oneDecimal(days / 365)}y`;
}

/** Each grade's next interval from `now`. Fuzz makes these approximate. */
export function previewIntervals(card: SerializedFsrsCard, now: Date): Record<FsrsGrade, string> {
	const preview = scheduler.repeat(deserializeCard(card), now);
	const out = {} as Record<FsrsGrade, string>;
	for (const g of FSRS_GRADES) out[g] = formatInterval(preview[g as Grade].card.due.getTime() - now.getTime());
	return out;
}

// ─── the queue ───────────────────────────────────────────────────────────────

function localMidnight(now: Date): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** New cards first reviewed since local midnight (the new-per-day budget). */
export function newIntroducedToday(reviews: readonly FlashcardReview[], now: Date): number {
	const since = localMidnight(now);
	return reviews.filter((r) => r.log.state === 0 && Date.parse(r.log.review) >= since).length;
}

/** Due and learning cards first (earliest due), then new cards oldest
 *  first up to what remains of today's new-card limit. */
export function buildQueue(
	cards: readonly FlashcardRecord[],
	reviews: readonly FlashcardReview[],
	now: Date,
	newPerDay: number,
): Omit<FlashcardQueue, "canUndo"> {
	const t = now.getTime();
	const due = cards
		.filter((c) => c.fsrs.state !== 0 && Date.parse(c.fsrs.due) <= t)
		.sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due));
	const remaining = Math.max(0, newPerDay - newIntroducedToday(reviews, now));
	const fresh = cards
		.filter((c) => c.fsrs.state === 0)
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
		.slice(0, remaining);
	const ordered = [...due, ...fresh];
	const later = cards
		.filter((c) => c.fsrs.state !== 0 && Date.parse(c.fsrs.due) > t)
		.reduce<number | null>((min, c) => Math.min(min ?? Infinity, Date.parse(c.fsrs.due)), null);
	return {
		cards: ordered.map((card) => ({ card, previews: previewIntervals(card.fsrs, now) })),
		count: ordered.length,
		...(later !== null ? { nextDueAt: new Date(later).toISOString() } : {}),
	};
}

// ─── input validation ────────────────────────────────────────────────────────

/** A malformed flashcard request (the honest 400). */
export class FlashcardInputError extends Error {}

function nonBlank(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0;
}

export function parseFlashcardReviewInput(input: unknown): FlashcardReviewInput {
	if (typeof input !== "object" || input === null) throw new FlashcardInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type === "undo") return { type: "undo" };
	if (i.type !== "rate") throw new FlashcardInputError(`unknown input type: ${String(i.type)}`);
	if (!nonBlank(i.cardId)) throw new FlashcardInputError("rate input requires cardId");
	if (!FSRS_GRADES.includes(i.grade as FsrsGrade)) throw new FlashcardInputError("grade must be 1, 2, 3 or 4");
	return { type: "rate", cardId: i.cardId, grade: i.grade as FsrsGrade };
}

export function parseFlashcardEdit(input: unknown): FlashcardEdit {
	if (typeof input !== "object" || input === null) throw new FlashcardInputError("edit must be an object");
	const i = input as Record<string, unknown>;
	if (!nonBlank(i.front) || !nonBlank(i.back)) throw new FlashcardInputError("front and back must be non-empty");
	return { front: i.front, back: i.back };
}

export function parseNewFlashcards(input: unknown, max: number): NewFlashcard[] {
	if (!Array.isArray(input) || input.length === 0) throw new FlashcardInputError("cards must be a non-empty array");
	if (input.length > max) throw new FlashcardInputError(`at most ${max} cards per call`);
	return input.map((c) => parseFlashcardEdit(c));
}
