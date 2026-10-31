/**
 * Flashcard persistence (design: docs/designs/flashcards.md): the card
 * file data/flashcards/cards.json (rewritten atomically) and the
 * append-only review log data/flashcards/reviews.jsonl. Synchronous
 * node:fs like the other stores, so one request's read-modify-write cannot
 * interleave with another's in the single server process.
 *
 * Reads are tolerant: malformed cards and torn log lines are skipped, so a
 * crash mid-write never fails a read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { FLASHCARD_FILES } from "../../config.ts";
import type { FlashcardRecord, FlashcardReview } from "../core/contracts/flashcards.ts";
import type { FlashcardStore } from "../core/ports.ts";

const isString = (v: unknown): v is string => typeof v === "string";
const isDate = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

function isFsrs(v: unknown): boolean {
	if (v === null || typeof v !== "object") return false;
	const r = v as Record<string, unknown>;
	return (
		isDate(r.due) &&
		[r.stability, r.difficulty, r.elapsed_days, r.scheduled_days, r.learning_steps, r.reps, r.lapses].every((n) => typeof n === "number") &&
		[0, 1, 2, 3].includes(r.state as number) &&
		(r.last_review === undefined || isDate(r.last_review))
	);
}

function isOrigin(v: unknown): boolean {
	if (v === null || typeof v !== "object") return false;
	const r = v as Record<string, unknown>;
	if (r.kind === "tool") return isString(r.chatId) && isString(r.toolCallId);
	if (r.kind === "extraction") return isString(r.chatId) && Array.isArray(r.propositionIds) && r.propositionIds.every(isString);
	return false;
}

function isCard(v: unknown): v is FlashcardRecord {
	if (v === null || typeof v !== "object") return false;
	const r = v as Record<string, unknown>;
	return (
		isString(r.id) && isString(r.front) && isString(r.back) &&
		isOrigin(r.origin) && isDate(r.createdAt) && isDate(r.updatedAt) && isFsrs(r.fsrs)
	);
}

function isReview(v: unknown): v is FlashcardReview {
	if (v === null || typeof v !== "object") return false;
	const r = v as Record<string, unknown>;
	if (r.v !== 1 || !isString(r.cardId) || !isFsrs(r.prev) || r.log === null || typeof r.log !== "object") return false;
	const log = r.log as Record<string, unknown>;
	return [1, 2, 3, 4].includes(log.rating as number) && [0, 1, 2, 3].includes(log.state as number) && isDate(log.review) && isDate(log.due);
}

function readCards(): FlashcardRecord[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(FLASHCARD_FILES.cards, "utf-8"));
	} catch {
		return [];
	}
	if (parsed === null || typeof parsed !== "object") return [];
	const r = parsed as { v?: unknown; cards?: unknown };
	if (r.v !== 1 || !Array.isArray(r.cards)) return [];
	const cards = r.cards.filter(isCard);
	if (cards.length < r.cards.length) console.warn(`[flashcards] skipped ${r.cards.length - cards.length} unreadable card(s)`);
	return cards;
}

/** Temp file + fsync + rename: a crash never leaves a half-written file. */
function writeAtomic(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	try {
		const fd = fs.openSync(tmp, "w");
		try {
			fs.writeFileSync(fd, text, "utf-8");
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

function writeCards(cards: FlashcardRecord[]): void {
	writeAtomic(FLASHCARD_FILES.cards, JSON.stringify({ v: 1, cards }));
}

function readReviewLines(): { review: FlashcardReview; line: string }[] {
	let raw: string;
	try {
		raw = fs.readFileSync(FLASHCARD_FILES.reviews, "utf-8");
	} catch {
		return [];
	}
	const out: { review: FlashcardReview; line: string }[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isReview(parsed)) out.push({ review: parsed, line });
		} catch {
			/* torn line */
		}
	}
	return out;
}

function readReviews(): FlashcardReview[] {
	return readReviewLines().map((l) => l.review);
}

function appendReview(review: FlashcardReview): void {
	fs.mkdirSync(path.dirname(FLASHCARD_FILES.reviews), { recursive: true });
	let prefix = "";
	try {
		const size = fs.statSync(FLASHCARD_FILES.reviews).size;
		if (size > 0) {
			const fd = fs.openSync(FLASHCARD_FILES.reviews, "r");
			try {
				const last = Buffer.alloc(1);
				fs.readSync(fd, last, 0, 1, size - 1);
				if (last[0] !== 0x0a) prefix = "\n"; // torn last line: don't merge with the next record
			} finally {
				fs.closeSync(fd);
			}
		}
	} catch {
		/* no file yet */
	}
	fs.appendFileSync(FLASHCARD_FILES.reviews, `${prefix}${JSON.stringify(review)}\n`, "utf-8");
}

function dropLastReview(): void {
	const lines = readReviewLines();
	if (!lines.length) return;
	writeAtomic(FLASHCARD_FILES.reviews, lines.slice(0, -1).map((l) => `${l.line}\n`).join(""));
}

export const flashcardStore: FlashcardStore = { readCards, writeCards, readReviews, appendReview, dropLastReview };
