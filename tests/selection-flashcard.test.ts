/**
 * The Make flashcard request text (docs/designs/flashcards.md, Prompts §3).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flashcardRequestText } from "../components/selection-flashcard.tsx";

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
