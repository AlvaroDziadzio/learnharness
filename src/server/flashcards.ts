/**
 * Flashcard service (design: docs/designs/flashcards.md): creation from the
 * teacher's tool and from extraction, the browse list, edits, deletion, the
 * review queue, ratings and one-step undo. Every change notifies
 * `flashcards-changed` so the review badge and open review views refetch.
 */

import { nanoid } from "nanoid";
import { emit } from "../core/events.ts";
import { buildQueue, newFsrsCard, rateCard } from "../core/flashcards.ts";
import type {
	FlashcardEdit,
	FlashcardOrigin,
	FlashcardQueue,
	FlashcardRecord,
	FlashcardReviewInput,
	NewFlashcard,
} from "../core/contracts/flashcards.ts";
import { effectiveSettings, stores } from "./stores.ts";

const { flashcardStore } = stores;

function newCardId(): string {
	return `fc_${nanoid()}`;
}

function create(chatId: string, origin: "tool" | "extraction", cards: { card: NewFlashcard; origin: FlashcardOrigin }[], now: Date): FlashcardRecord[] {
	if (!cards.length) return [];
	const at = now.toISOString();
	const fsrs = newFsrsCard(now);
	const created = cards.map(({ card, origin: o }) => ({
		id: newCardId(),
		front: card.front,
		back: card.back,
		origin: o,
		createdAt: at,
		updatedAt: at,
		fsrs,
	}));
	flashcardStore.writeCards([...flashcardStore.readCards(), ...created]);
	emit("flashcards-changed", { chatId, added: created.length, origin });
	return created;
}

export function createToolFlashcards(chatId: string, toolCallId: string, cards: NewFlashcard[], now = new Date()): FlashcardRecord[] {
	return create(chatId, "tool", cards.map((card) => ({ card, origin: { kind: "tool", chatId, toolCallId } })), now);
}

export function createExtractionFlashcards(
	chatId: string,
	cards: (NewFlashcard & { propositionIds: string[] })[],
	now = new Date(),
): FlashcardRecord[] {
	return create(
		chatId,
		"extraction",
		cards.map(({ front, back, propositionIds }) => ({
			card: { front, back },
			origin: { kind: "extraction", chatId, propositionIds },
		})),
		now,
	);
}

/** Newest first; `query` matches front or back, case-insensitively. */
export function listFlashcards(query?: string): FlashcardRecord[] {
	const q = query?.trim().toLowerCase();
	const cards = flashcardStore.readCards().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
	return q ? cards.filter((c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)) : cards;
}

/** One entry per id, null where the card no longer exists. */
export function getFlashcards(ids: readonly string[]): (FlashcardRecord | null)[] {
	const byId = new Map(flashcardStore.readCards().map((c) => [c.id, c]));
	return ids.map((id) => byId.get(id) ?? null);
}

export function editFlashcard(id: string, edit: FlashcardEdit, now = new Date()): FlashcardRecord | null {
	const cards = flashcardStore.readCards();
	const i = cards.findIndex((c) => c.id === id);
	if (i < 0) return null;
	const edited = { ...cards[i]!, front: edit.front, back: edit.back, updatedAt: now.toISOString() };
	cards[i] = edited;
	flashcardStore.writeCards(cards);
	emit("flashcards-changed", {});
	return edited;
}

/** The review history stays: it is the learner's record, not the card's. */
export function deleteFlashcard(id: string): boolean {
	const cards = flashcardStore.readCards();
	const kept = cards.filter((c) => c.id !== id);
	if (kept.length === cards.length) return false;
	flashcardStore.writeCards(kept);
	emit("flashcards-changed", {});
	return true;
}

// ─── review ──────────────────────────────────────────────────────────────────

/** The one undoable rating: the log line this process appended last. Undo
 *  is one step by design, so it is cleared on use; a restart drops it. */
let undoable: { cardId: string; review: string } | null = null;

/** Test seam: the undo slot is process state. */
export function resetUndoForTests(): void {
	undoable = null;
}

function canUndo(): boolean {
	if (!undoable) return false;
	const last = flashcardStore.readReviews().at(-1);
	return last?.cardId === undoable.cardId && last.log.review === undoable.review;
}

export function flashcardQueue(now = new Date()): FlashcardQueue {
	const { newPerDay } = effectiveSettings().flashcards;
	return { ...buildQueue(flashcardStore.readCards(), flashcardStore.readReviews(), now, newPerDay), canUndo: canUndo() };
}

export type FlashcardReviewResult =
	| { ok: true }
	| { ok: false; status: 404 | 409; error: "card_not_found" | "nothing_to_undo" };

export function reviewFlashcard(input: FlashcardReviewInput, now = new Date()): FlashcardReviewResult {
	const cards = flashcardStore.readCards();
	if (input.type === "rate") {
		const i = cards.findIndex((c) => c.id === input.cardId);
		if (i < 0) return { ok: false, status: 404, error: "card_not_found" };
		const prev = cards[i]!.fsrs;
		const { fsrs, log } = rateCard(prev, input.grade, now);
		flashcardStore.appendReview({ v: 1, cardId: input.cardId, log, prev });
		cards[i] = { ...cards[i]!, fsrs };
		flashcardStore.writeCards(cards);
		undoable = { cardId: input.cardId, review: log.review };
		emit("flashcards-changed", {});
		return { ok: true };
	}
	if (!canUndo()) return { ok: false, status: 409, error: "nothing_to_undo" };
	const last = flashcardStore.readReviews().at(-1)!;
	undoable = null;
	const i = cards.findIndex((c) => c.id === last.cardId);
	if (i >= 0) {
		cards[i] = { ...cards[i]!, fsrs: last.prev };
		flashcardStore.writeCards(cards);
	}
	flashcardStore.dropLastReview();
	emit("flashcards-changed", {});
	return { ok: true };
}
