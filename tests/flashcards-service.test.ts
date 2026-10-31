/**
 * Flashcard service (docs/designs/flashcards.md): src/server/flashcards.ts
 * against a temp LH_DATA_DIR with real settings.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-flashcards-service-"));
process.env.LH_DATA_DIR = dir;
const { stores } = await import("../src/server/stores.ts");
const fc = await import("../src/server/flashcards.ts");
const { subscribe } = await import("../src/core/events.ts");

after(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
	fs.rmSync(path.join(dir, "flashcards"), { recursive: true, force: true });
	stores.settingsStore.writeSettings({ version: 1 });
	fc.resetUndoForTests();
});

const T0 = new Date("2026-10-31T12:00:00.000Z");
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("creation", () => {
	it("tool cards carry their origin and start New, due now", () => {
		const [c] = fc.createToolFlashcards("chat1", "call1", [{ front: "Q", back: "A" }], T0);
		assert.match(c!.id, /^fc_[\w-]{21}$/);
		assert.deepEqual(c!.origin, { kind: "tool", chatId: "chat1", toolCallId: "call1" });
		assert.equal(c!.fsrs.state, 0);
		assert.equal(stores.flashcardStore.readCards().length, 1);
	});

	it("extraction cards carry their proposition ids", () => {
		const [c] = fc.createExtractionFlashcards("chat1", [{ front: "Q", back: "A", propositionIds: ["p1"] }], T0);
		assert.deepEqual(c!.origin, { kind: "extraction", chatId: "chat1", propositionIds: ["p1"] });
	});

	it("emits flashcards-changed with chat, count and origin", () => {
		const seen: unknown[] = [];
		const off = subscribe((e) => seen.push(e));
		fc.createExtractionFlashcards("chat1", [{ front: "Q", back: "A", propositionIds: ["p1"] }, { front: "Q2", back: "A2", propositionIds: ["p2"] }], T0);
		off();
		assert.deepEqual(seen, [{ type: "flashcards-changed", chatId: "chat1", added: 2, origin: "extraction" }]);
	});

	it("creating nothing writes and emits nothing", () => {
		const seen: unknown[] = [];
		const off = subscribe((e) => seen.push(e));
		assert.deepEqual(fc.createExtractionFlashcards("chat1", [], T0), []);
		off();
		assert.deepEqual(seen, []);
		assert.equal(fs.existsSync(path.join(dir, "flashcards", "cards.json")), false);
	});
});

describe("list, edit, delete", () => {
	it("lists newest first and searches front and back case-insensitively", () => {
		fc.createToolFlashcards("c", "t", [{ front: "Derivative", back: "slope" }], T0);
		fc.createToolFlashcards("c", "t2", [{ front: "Integral", back: "Area" }], plus(1));
		assert.deepEqual(fc.listFlashcards().map((c) => c.front), ["Integral", "Derivative"]);
		assert.deepEqual(fc.listFlashcards("AREA").map((c) => c.front), ["Integral"]);
		assert.deepEqual(fc.listFlashcards("  ").length, 2);
	});

	it("edits front and back, keeping schedule; unknown id is null", () => {
		const [c] = fc.createToolFlashcards("c", "t", [{ front: "Q", back: "A" }], T0);
		const edited = fc.editFlashcard(c!.id, { front: "Q2", back: "A2" }, plus(5));
		assert.equal(edited!.front, "Q2");
		assert.equal(edited!.updatedAt, plus(5).toISOString());
		assert.deepEqual(edited!.fsrs, c!.fsrs);
		assert.equal(fc.editFlashcard("fc_nope", { front: "x", back: "y" }, T0), null);
	});

	it("deletes by id", () => {
		const [c] = fc.createToolFlashcards("c", "t", [{ front: "Q", back: "A" }], T0);
		assert.equal(fc.deleteFlashcard(c!.id), true);
		assert.equal(fc.deleteFlashcard(c!.id), false);
		assert.deepEqual(fc.getFlashcards([c!.id]), [null]);
	});
});

describe("queue, rate, undo", () => {
	it("rating moves a card out of the queue and logs it", () => {
		const [c] = fc.createToolFlashcards("c", "t", [{ front: "Q", back: "A" }], T0);
		assert.equal(fc.flashcardQueue(T0).count, 1);
		assert.deepEqual(fc.reviewFlashcard({ type: "rate", cardId: c!.id, grade: 3 }, T0), { ok: true });
		assert.equal(fc.flashcardQueue(T0).count, 0);
		assert.equal(stores.flashcardStore.readReviews().length, 1);
		assert.equal(fc.flashcardQueue(T0).canUndo, true);
	});

	it("rating an unknown card is a 404", () => {
		assert.deepEqual(fc.reviewFlashcard({ type: "rate", cardId: "fc_nope", grade: 3 }, T0), { ok: false, status: 404, error: "card_not_found" });
	});

	it("undo restores the card exactly and drops the log line, once", () => {
		const [c] = fc.createToolFlashcards("c", "t", [{ front: "Q", back: "A" }], T0);
		const [d] = fc.createToolFlashcards("c", "t", [{ front: "Q2", back: "A2" }], T0);
		fc.reviewFlashcard({ type: "rate", cardId: c!.id, grade: 3 }, T0);
		fc.reviewFlashcard({ type: "rate", cardId: d!.id, grade: 1 }, plus(1));
		assert.deepEqual(fc.reviewFlashcard({ type: "undo" }, plus(2)), { ok: true });
		assert.deepEqual(fc.getFlashcards([d!.id])[0]!.fsrs, d!.fsrs);
		assert.deepEqual(stores.flashcardStore.readReviews().map((r) => r.cardId), [c!.id]);
		assert.equal(fc.flashcardQueue(plus(2)).canUndo, false);
		assert.deepEqual(fc.reviewFlashcard({ type: "undo" }, plus(2)), { ok: false, status: 409, error: "nothing_to_undo" });
	});

	it("respects the newPerDay setting", () => {
		stores.settingsStore.writeSettings({ version: 1, flashcards: { newPerDay: 1 } });
		fc.createToolFlashcards("c", "t", [{ front: "Q", back: "A" }, { front: "Q2", back: "A2" }], T0);
		assert.equal(fc.flashcardQueue(T0).count, 1);
	});
});
