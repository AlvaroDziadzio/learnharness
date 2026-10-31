/**
 * Flashcard contracts (design: docs/designs/flashcards.md): the stored card,
 * the review log line, and the request/result shapes of the review page.
 * FSRS state is stored with ISO date strings; core/flashcards.ts converts
 * to and from ts-fsrs's Date-bearing Card.
 */

/** ts-fsrs State, by number: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export type FsrsState = 0 | 1 | 2 | 3;
/** ts-fsrs Grade: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type FsrsGrade = 1 | 2 | 3 | 4;

/** A ts-fsrs Card with its dates serialized. */
export interface SerializedFsrsCard {
	due: string;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	state: FsrsState;
	last_review?: string;
}

/** A ts-fsrs ReviewLog with its dates serialized. */
export interface SerializedReviewLog {
	rating: FsrsGrade;
	state: FsrsState;
	due: string;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	last_elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	review: string;
}

export type FlashcardOrigin =
	| { kind: "tool"; chatId: string; toolCallId: string }
	| { kind: "extraction"; chatId: string; propositionIds: string[] };

export interface FlashcardRecord {
	id: string;
	front: string;
	back: string;
	origin: FlashcardOrigin;
	createdAt: string;
	updatedAt: string;
	fsrs: SerializedFsrsCard;
}

/** data/flashcards/cards.json */
export interface FlashcardsFile {
	v: 1;
	cards: FlashcardRecord[];
}

/** One line of data/flashcards/reviews.jsonl. `prev` is the card state
 *  before the rating, so undo restores it exactly. */
export interface FlashcardReview {
	v: 1;
	cardId: string;
	log: SerializedReviewLog;
	prev: SerializedFsrsCard;
}

/** A card as the review page shows it: the record plus each grade's
 *  next interval, already formatted ("10m", "3d"). */
export interface QueueCard {
	card: FlashcardRecord;
	previews: Record<FsrsGrade, string>;
}

export interface FlashcardQueue {
	/** Due and learning cards first (earliest due), then new (oldest first). */
	cards: QueueCard[];
	/** The sidebar badge: due now + new still allowed today. */
	count: number;
	/** Whether the last rating can be undone. */
	canUndo: boolean;
	/** The earliest due time among started cards not yet due (a learning
	 *  step a few minutes out) — the review page refetches then. */
	nextDueAt?: string;
}

export type FlashcardReviewInput =
	| { type: "rate"; cardId: string; grade: FsrsGrade }
	| { type: "undo" };

export interface FlashcardEdit {
	front: string;
	back: string;
}

export interface NewFlashcard {
	front: string;
	back: string;
}
