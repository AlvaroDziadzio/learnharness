/**
 * Flashcard store (docs/designs/flashcards.md): src/store/flashcards.ts
 * against a temp LH_DATA_DIR, set BEFORE the dynamic imports.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { FlashcardRecord, FlashcardReview } from "../src/core/contracts/flashcards.ts";
import { newFsrsCard, rateCard } from "../src/core/flashcards.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-flashcards-store-"));
process.env.LH_DATA_DIR = dir;
const { FLASHCARD_FILES } = await import("../config.ts");
const { flashcardStore } = await import("../src/store/flashcards.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => fs.rmSync(path.join(dir, "flashcards"), { recursive: true, force: true }));

const NOW = new Date("2026-10-31T12:00:00.000Z");
const card = (id: string): FlashcardRecord => ({
	id,
	front: "Q",
	back: "A",
	origin: { kind: "extraction", chatId: "c1", propositionIds: ["p1"] },
	createdAt: NOW.toISOString(),
	updatedAt: NOW.toISOString(),
	fsrs: newFsrsCard(NOW),
});
const review = (cardId: string): FlashcardReview => {
	const prev = newFsrsCard(NOW);
	return { v: 1, cardId, log: rateCard(prev, 3, NOW).log, prev };
};

describe("flashcard store: cards.json", () => {
	it("lives under data/flashcards", () => {
		assert.equal(FLASHCARD_FILES.cards, path.join(dir, "flashcards", "cards.json"));
		assert.equal(FLASHCARD_FILES.reviews, path.join(dir, "flashcards", "reviews.jsonl"));
	});

	it("reads empty when missing, round-trips, and stamps v:1", () => {
		assert.deepEqual(flashcardStore.readCards(), []);
		flashcardStore.writeCards([card("fc_a"), card("fc_b")]);
		assert.deepEqual(flashcardStore.readCards().map((c) => c.id), ["fc_a", "fc_b"]);
		assert.equal(JSON.parse(fs.readFileSync(FLASHCARD_FILES.cards, "utf-8")).v, 1);
	});

	it("skips malformed cards instead of failing the read", () => {
		fs.mkdirSync(path.dirname(FLASHCARD_FILES.cards), { recursive: true });
		fs.writeFileSync(FLASHCARD_FILES.cards, JSON.stringify({ v: 1, cards: [card("fc_ok"), { id: "bad" }] }));
		assert.deepEqual(flashcardStore.readCards().map((c) => c.id), ["fc_ok"]);
	});

	it("reads empty for an unknown version", () => {
		fs.mkdirSync(path.dirname(FLASHCARD_FILES.cards), { recursive: true });
		fs.writeFileSync(FLASHCARD_FILES.cards, JSON.stringify({ v: 2, cards: [card("fc_ok")] }));
		assert.deepEqual(flashcardStore.readCards(), []);
	});
});

describe("flashcard store: reviews.jsonl", () => {
	it("appends, reads in order and tolerates a torn line", () => {
		flashcardStore.appendReview(review("fc_a"));
		fs.appendFileSync(FLASHCARD_FILES.reviews, '{"v":1,"card');
		flashcardStore.appendReview(review("fc_b"));
		assert.deepEqual(flashcardStore.readReviews().map((r) => r.cardId), ["fc_a", "fc_b"]);
	});

	it("dropLastReview removes only the last valid line", () => {
		flashcardStore.appendReview(review("fc_a"));
		flashcardStore.appendReview(review("fc_b"));
		flashcardStore.dropLastReview();
		assert.deepEqual(flashcardStore.readReviews().map((r) => r.cardId), ["fc_a"]);
		flashcardStore.dropLastReview();
		flashcardStore.dropLastReview();
		assert.deepEqual(flashcardStore.readReviews(), []);
	});
});
