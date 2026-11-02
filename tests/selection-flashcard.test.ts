/**
 * The Make flashcard request text (docs/designs/flashcards.md, Prompts §3).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flashcardRequestText, queuedFlashcardAction } from "../components/selection-flashcard.tsx";

describe("flashcardRequestText", () => {
	it("quotes every line under the fixed lead", () => {
		assert.equal(
			flashcardRequestText("  Energy is conserved.\nMomentum too.  "),
			"Make flashcards from this passage:\n\n> Energy is conserved.\n> Momentum too.",
		);
	});

	it("keeps blank lines as bare quote markers", () => {
		assert.equal(flashcardRequestText("a\n\nb"), "Make flashcards from this passage:\n\n> a\n>\n> b");
	});
});

describe("queuedFlashcardAction (requests made while a question waits)", () => {
	const base = { queued: 1, pending: false, busy: false, compacting: false, answering: false };

	it("waits while the question is still pending, or with nothing queued", () => {
		assert.equal(queuedFlashcardAction({ ...base, pending: true }), "wait");
		assert.equal(queuedFlashcardAction({ ...base, pending: true, busy: true }), "wait");
		assert.equal(queuedFlashcardAction({ ...base, queued: 0 }), "wait");
	});

	it("steers into the turn the answer started", () => {
		assert.equal(queuedFlashcardAction({ ...base, busy: true, answering: true }), "steer");
		assert.equal(queuedFlashcardAction({ ...base, busy: true }), "steer");
	});

	it("waits for the answer's turn to start instead of racing it", () => {
		assert.equal(queuedFlashcardAction({ ...base, answering: true }), "wait");
	});

	it("sends as a normal message after a dismissal (no turn is coming)", () => {
		assert.equal(queuedFlashcardAction(base), "send");
		assert.equal(queuedFlashcardAction({ ...base, compacting: true }), "wait");
	});
});
