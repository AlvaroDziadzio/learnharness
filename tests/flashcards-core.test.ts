/**
 * Flashcards — the pure core (docs/designs/flashcards.md):
 * src/core/flashcards.ts. No fs, no server.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { default_w } from "ts-fsrs";
import type { FlashcardRecord, FlashcardReview, FsrsGrade } from "../src/core/contracts/flashcards.ts";
import {
	FlashcardInputError,
	FSRS_PARAMETERS,
	buildQueue,
	formatInterval,
	newFsrsCard,
	newIntroducedToday,
	parseFlashcardEdit,
	parseFlashcardReviewInput,
	parseNewFlashcards,
	previewIntervals,
	rateCard,
} from "../src/core/flashcards.ts";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-31T12:00:00.000Z");

function card(id: string, createdAt: string, fsrs = newFsrsCard(at(createdAt))): FlashcardRecord {
	return {
		id,
		front: `front ${id}`,
		back: `back ${id}`,
		origin: { kind: "tool", chatId: "c1", toolCallId: "t1" },
		createdAt,
		updatedAt: createdAt,
		fsrs,
	};
}

function reviewOf(c: FlashcardRecord, grade: FsrsGrade, when: Date): FlashcardReview {
	const { log } = rateCard(c.fsrs, grade, when);
	return { v: 1, cardId: c.id, log, prev: c.fsrs };
}

describe("FSRS parameters", () => {
	it("are FSRS-6 defaults with the agreed knobs", () => {
		assert.equal(default_w.length, 21);
		assert.deepEqual([...FSRS_PARAMETERS.w], [...default_w]);
		assert.equal(FSRS_PARAMETERS.request_retention, 0.9);
		assert.equal(FSRS_PARAMETERS.enable_fuzz, true);
		assert.equal(FSRS_PARAMETERS.enable_short_term, true);
		assert.equal(FSRS_PARAMETERS.maximum_interval, 36500);
	});
});

describe("rateCard", () => {
	it("moves a new card out of New and logs the pre-review state", () => {
		const fresh = newFsrsCard(NOW);
		assert.equal(fresh.state, 0);
		assert.equal(fresh.due, NOW.toISOString());
		const { fsrs, log } = rateCard(fresh, 3, NOW);
		assert.notEqual(fsrs.state, 0);
		assert.equal(fsrs.reps, 1);
		assert.equal(log.state, 0);
		assert.equal(log.rating, 3);
		assert.equal(log.review, NOW.toISOString());
		assert.ok(Date.parse(fsrs.due) > NOW.getTime());
	});

	it("Again schedules sooner than Easy", () => {
		const fresh = newFsrsCard(NOW);
		assert.ok(Date.parse(rateCard(fresh, 1, NOW).fsrs.due) < Date.parse(rateCard(fresh, 4, NOW).fsrs.due));
	});
});

describe("previewIntervals / formatInterval", () => {
	it("formats minutes, hours and days", () => {
		assert.equal(formatInterval(60_000), "1m");
		assert.equal(formatInterval(10 * 60_000), "10m");
		assert.equal(formatInterval(3 * 3_600_000), "3h");
		assert.equal(formatInterval(3 * 86_400_000), "3d");
		assert.equal(formatInterval(45 * 86_400_000), "1.5mo");
		assert.equal(formatInterval(2 * 365 * 86_400_000), "2y");
	});

	it("gives one label per grade for a new card", () => {
		const p = previewIntervals(newFsrsCard(NOW), NOW);
		assert.deepEqual(Object.keys(p).sort(), ["1", "2", "3", "4"]);
		assert.equal(p[1], "1m");
	});
});

describe("newIntroducedToday", () => {
	it("counts reviews of New cards since local midnight", () => {
		const a = card("a", "2026-10-30T00:00:00.000Z");
		const b = card("b", "2026-10-30T00:00:00.000Z");
		const midnight = new Date(NOW);
		midnight.setHours(0, 0, 0, 0);
		const yesterday = new Date(midnight.getTime() - 60_000);
		const reviews = [reviewOf(a, 3, yesterday), reviewOf(b, 3, new Date(midnight.getTime() + 60_000))];
		assert.equal(newIntroducedToday(reviews, NOW), 1);
	});

	it("does not count a later review of a card that is no longer New", () => {
		const a = card("a", "2026-10-30T00:00:00.000Z");
		const first = reviewOf(a, 1, NOW);
		const learning = { ...a, fsrs: rateCard(a.fsrs, 1, NOW).fsrs };
		const second = reviewOf(learning, 3, NOW);
		assert.equal(newIntroducedToday([first, second], NOW), 1);
	});
});

describe("buildQueue", () => {
	it("puts due cards first by due date, then new cards oldest first, skipping future cards", () => {
		const n1 = card("n1", "2026-10-29T00:00:00.000Z");
		const n2 = card("n2", "2026-10-28T00:00:00.000Z");
		const reviewed = rateCard(newFsrsCard(at("2026-10-01T00:00:00.000Z")), 3, at("2026-10-01T00:00:00.000Z")).fsrs;
		const dueEarly = card("dueEarly", "2026-10-01T00:00:00.000Z", { ...reviewed, due: "2026-10-20T00:00:00.000Z" });
		const dueLate = card("dueLate", "2026-10-01T00:00:00.000Z", { ...reviewed, due: "2026-10-30T00:00:00.000Z" });
		const future = card("future", "2026-10-01T00:00:00.000Z", { ...reviewed, due: "2026-11-30T00:00:00.000Z" });
		const q = buildQueue([n1, dueLate, future, n2, dueEarly], [], NOW, 20);
		assert.deepEqual(q.cards.map((c) => c.card.id), ["dueEarly", "dueLate", "n2", "n1"]);
		assert.equal(q.count, 4);
		assert.equal(q.cards[0]!.previews[3].length > 0, true);
	});

	it("reports when the next started card comes due", () => {
		const reviewed = rateCard(newFsrsCard(NOW), 1, NOW).fsrs;
		const q = buildQueue([card("learning", NOW.toISOString(), reviewed)], [], NOW, 20);
		assert.equal(q.count, 0);
		assert.equal(q.nextDueAt, reviewed.due);
		assert.equal(buildQueue([card("n", NOW.toISOString())], [], NOW, 20).nextDueAt, undefined);
	});

	it("caps new cards by what remains of today's limit", () => {
		const cards = ["a", "b", "c"].map((id, i) => card(id, `2026-10-2${i}T00:00:00.000Z`));
		const seen = card("seen", "2026-10-01T00:00:00.000Z");
		const q = buildQueue(cards, [reviewOf(seen, 4, NOW)], NOW, 2);
		assert.deepEqual(q.cards.map((c) => c.card.id), ["a"]);
		assert.equal(q.count, 1);
	});

	it("never goes negative when the limit is already spent", () => {
		const seen = ["x", "y", "z"].map((id) => reviewOf(card(id, "2026-10-01T00:00:00.000Z"), 3, NOW));
		const q = buildQueue([card("a", "2026-10-20T00:00:00.000Z")], seen, NOW, 2);
		assert.equal(q.count, 0);
		assert.deepEqual(q.cards, []);
	});
});

describe("input parsing", () => {
	it("accepts rate and undo", () => {
		assert.deepEqual(parseFlashcardReviewInput({ type: "rate", cardId: "fc_1", grade: 3 }), { type: "rate", cardId: "fc_1", grade: 3 });
		assert.deepEqual(parseFlashcardReviewInput({ type: "undo" }), { type: "undo" });
	});

	it("refuses a bad grade, a missing card id and unknown types", () => {
		assert.throws(() => parseFlashcardReviewInput({ type: "rate", cardId: "fc_1", grade: 0 }), FlashcardInputError);
		assert.throws(() => parseFlashcardReviewInput({ type: "rate", grade: 3 }), FlashcardInputError);
		assert.throws(() => parseFlashcardReviewInput({ type: "skip" }), FlashcardInputError);
		assert.throws(() => parseFlashcardReviewInput(null), FlashcardInputError);
	});

	it("edits need non-blank front and back", () => {
		assert.deepEqual(parseFlashcardEdit({ front: "Q", back: "A" }), { front: "Q", back: "A" });
		assert.throws(() => parseFlashcardEdit({ front: " ", back: "A" }), FlashcardInputError);
		assert.throws(() => parseFlashcardEdit({ front: "Q" }), FlashcardInputError);
	});

	it("new cards are 1–max non-blank pairs", () => {
		assert.deepEqual(parseNewFlashcards([{ front: "Q", back: "A" }], 10), [{ front: "Q", back: "A" }]);
		assert.throws(() => parseNewFlashcards([], 10), FlashcardInputError);
		assert.throws(() => parseNewFlashcards([{ front: "Q", back: "" }], 10), FlashcardInputError);
		assert.throws(() => parseNewFlashcards(Array.from({ length: 11 }, () => ({ front: "Q", back: "A" })), 10), FlashcardInputError);
	});
});
