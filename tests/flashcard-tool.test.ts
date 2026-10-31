/**
 * The teacher's flashcard tool (docs/designs/flashcards.md):
 * src/agent/tools/flashcard.ts and its registry seam.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FlashcardRecord, NewFlashcard } from "../src/core/contracts/flashcards.ts";
import { newFsrsCard } from "../src/core/flashcards.ts";
import { createProberTools, createTeacherTools } from "../src/agent/tools.ts";
import { flashcardTool } from "../src/agent/tools/flashcard.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");

function fakeCreate() {
	const calls: { chatId: string; toolCallId: string; cards: NewFlashcard[] }[] = [];
	const create = (chatId: string, toolCallId: string, cards: NewFlashcard[]): FlashcardRecord[] => {
		calls.push({ chatId, toolCallId, cards });
		return cards.map((c, i) => ({
			id: `fc_${i}`,
			...c,
			origin: { kind: "tool", chatId, toolCallId },
			createdAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			fsrs: newFsrsCard(NOW),
		}));
	};
	return { calls, create };
}

const baseCtx = {
	chatId: "chat1",
	chatStore: {} as ChatStore,
	jobStore: {} as JobStore,
	spawn: () => {},
};

describe("flashcard tool", () => {
	it("saves through the seam with the call id and returns the card ids as details", async () => {
		const { calls, create } = fakeCreate();
		const tool = flashcardTool({ chatId: "chat1", createFlashcards: create });
		const result = await tool.execute("call_7", { cards: [{ front: "Q", back: "A" }, { front: "Q2", back: "A2" }] });
		assert.deepEqual(calls, [{ chatId: "chat1", toolCallId: "call_7", cards: [{ front: "Q", back: "A" }, { front: "Q2", back: "A2" }] }]);
		assert.deepEqual(result.details, { cardIds: ["fc_0", "fc_1"] });
		assert.deepEqual(result.content, [{ type: "text", text: "Added 2 flashcards to the review queue." }]);
		assert.equal(result.terminate, undefined);
	});

	it("declares 1–10 cards with non-blank front and back", () => {
		const tool = flashcardTool({ chatId: "c", createFlashcards: fakeCreate().create });
		const cards = (tool.parameters as unknown as { properties: { cards: { minItems: number; maxItems: number } } }).properties.cards;
		assert.equal(cards.minItems, 1);
		assert.equal(cards.maxItems, 10);
	});
});

describe("registry", () => {
	it("the teacher has the tool when the seam is wired", () => {
		assert.ok("flashcard" in createTeacherTools({ ...baseCtx, createFlashcards: fakeCreate().create }));
	});

	it("the teacher lacks it without the seam, and the prober never has it", () => {
		assert.ok(!("flashcard" in createTeacherTools(baseCtx)));
		assert.ok(!("flashcard" in createProberTools({ ...baseCtx, deliver: () => {} })));
	});
});
