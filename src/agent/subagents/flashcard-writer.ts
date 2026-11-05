/**
 * The auto-flashcard writer (design: docs/designs/flashcards.md): one
 * single-submit agent over the propositions an extraction batch just
 * CREATED. It may write nothing; it never fails extraction — the caller
 * isolates it.
 */

import type { Usage } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import { composeFlashcardStyle } from "../prompt-segments.ts";

export const MAX_AUTO_CARDS = 5;

export const FLASHCARD_WRITER_INSTRUCTIONS = `You write flashcards for a learner's spaced-repetition queue. You receive propositions that were just added to their knowledge graph from a teaching session, each with an id and statement.

Choose only propositions worth memorizing for recall — definitions, key facts, named results, and conclusions the learner will build on. Skip restatements, scaffolding, examples, and anything trivially derivable. It is fine to submit no cards.

Write at most ${MAX_AUTO_CARDS} cards. Each card has a \`front\`, a \`back\`, and the \`propositionIds\` it tests (at least one, from the ids given). Markdown and LaTeX are supported. Write them by the card-writing rules below.`;

/** The writer's whole system prompt (owner, 2026-11-05): its own
 *  instructions, then the flashcards group the teacher also composes —
 *  the learner's override of it when switched on. */
export function flashcardWriterPrompt(switches: Record<string, boolean>): string {
	return [FLASHCARD_WRITER_INSTRUCTIONS, composeFlashcardStyle(switches)].filter(Boolean).join("\n\n---\n\n");
}

const submitSchema = Type.Object({
	cards: Type.Array(
		Type.Object({
			front: Type.String({ minLength: 1, pattern: "\\S" }),
			back: Type.String({ minLength: 1, pattern: "\\S" }),
			propositionIds: Type.Array(Type.String(), { minItems: 1 }),
		}),
		{ maxItems: MAX_AUTO_CARDS },
	),
});

export type WrittenFlashcard = Static<typeof submitSchema>["cards"][number];

/** Weak-model tolerance: a whole `cards` array emitted as one JSON string. */
function healCards(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const cards = (raw as { cards?: unknown }).cards;
	if (typeof cards !== "string") return raw;
	try {
		const parsed: unknown = JSON.parse(cards);
		return Array.isArray(parsed) ? { ...raw, cards: parsed } : raw;
	} catch {
		return raw;
	}
}

export function validateWrittenCards(cards: readonly WrittenFlashcard[], known: ReadonlySet<string>): string | null {
	const unknown = [...new Set(cards.flatMap((c) => c.propositionIds).filter((id) => !known.has(id)))];
	return unknown.length ? `Unknown proposition ids: ${unknown.join(", ")}. Use only the ids given.` : null;
}

export async function runFlashcardWriter(opts: {
	engine: PiEngine | undefined;
	chatId: string;
	propositions: readonly { id: string; statement: string }[];
	signal: AbortSignal | undefined;
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void;
	/** The settings record's prompt switches (agent.prompts) — absent =
	 *  every flashcards fragment composes its source. */
	promptSwitches?: Record<string, boolean>;
}): Promise<WrittenFlashcard[]> {
	const known = new Set(opts.propositions.map((p) => p.id));
	const { cards } = await runSubmitAgent<Static<typeof submitSchema>>({
		role: "extractor",
		chatId: opts.chatId,
		toolName: "submit_flashcards",
		toolDescription: `Submit the flashcards (0–${MAX_AUTO_CARDS}).`,
		parameters: submitSchema,
		fill: (input) => input,
		validate: (value) => validateWrittenCards(value.cards, known),
		systemPrompt: flashcardWriterPrompt(opts.promptSwitches ?? {}),
		prompt: JSON.stringify({ propositions: opts.propositions.map((p) => ({ id: p.id, statement: p.statement })) }, null, 2),
		engine: opts.engine,
		signal: opts.signal,
		onStep: opts.onStep,
		neverSubmitted: "the flashcard writer never submitted cards",
		prepareArguments: healCards,
	});
	return cards;
}
