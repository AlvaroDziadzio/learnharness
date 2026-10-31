import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { MAX_TOOL_CARDS } from "../../core/flashcards.ts";
import type { FlashcardRecord, NewFlashcard } from "../../core/contracts/flashcards.ts";

export const FLASHCARD_TOOL = "flashcard";

const flashcardInput = Type.Object({
	cards: Type.Array(
		Type.Object({
			front: Type.String({ minLength: 1, pattern: "\\S", description: "The recall prompt shown first." }),
			back: Type.String({ minLength: 1, pattern: "\\S", description: "The answer revealed after recall." }),
		}),
		{ minItems: 1, maxItems: MAX_TOOL_CARDS },
	),
});

/** What the flashcard tool closes over: the session and the store seam
 *  (agents cannot import the server; the composition root injects it). */
export interface FlashcardToolContext {
	chatId: string;
	createFlashcards: (chatId: string, toolCallId: string, cards: NewFlashcard[]) => FlashcardRecord[];
}

/** The record-facing result: the transcript card looks the cards up by id,
 *  so later edits and deletions show. */
export interface FlashcardToolDetails {
	cardIds: string[];
}

/**
 * The teacher's flashcard tool (design: docs/designs/flashcards.md):
 * SERVER-SIDE, synchronous, non-pausing. Cards land in the review queue at
 * once; the description stays mechanical (when to use it lives in the
 * teacher prompt, prompts/teacher/45-flashcards.md).
 */
export function flashcardTool(ctx: FlashcardToolContext): AgentTool<typeof flashcardInput> {
	return {
		name: FLASHCARD_TOOL,
		label: FLASHCARD_TOOL,
		description:
			"Add flashcards to the learner's spaced-repetition review queue. Each card has a `front` (the prompt the " +
			"learner sees) and a `back` (the answer revealed after they try to recall it). Markdown and LaTeX are " +
			`supported in both. Pass 1–${MAX_TOOL_CARDS} cards per call. Cards are saved immediately and shown to the ` +
			"learner in the transcript, where they can edit or delete them. This tool does not pause or end your turn.",
		parameters: flashcardInput,
		execute: serverExecute(FLASHCARD_TOOL, flashcardInput, (input, { toolCallId }) => {
			const created = ctx.createFlashcards(ctx.chatId, toolCallId, input.cards);
			const details: FlashcardToolDetails = { cardIds: created.map((c) => c.id) };
			return { text: `Added ${created.length} flashcard${created.length === 1 ? "" : "s"} to the review queue.`, details };
		}),
	};
}
