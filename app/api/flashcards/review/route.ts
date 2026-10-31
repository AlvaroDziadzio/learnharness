/**
 * /api/flashcards/review — rate a card or undo the last rating (design:
 * docs/designs/flashcards.md).
 *
 *   POST { input: { type: "rate", cardId, grade: 1–4 } | { type: "undo" } }
 *     → 200 { ok: true } | 400 invalid_body | 404 card_not_found | 409 nothing_to_undo
 */
import { FlashcardInputError, parseFlashcardReviewInput } from "@/src/core";
import { reviewFlashcard } from "@/src/server";

export async function POST(req: Request) {
	let input;
	try {
		input = parseFlashcardReviewInput(((await req.json()) as { input?: unknown } | null)?.input);
	} catch (err) {
		if (err instanceof FlashcardInputError || err instanceof SyntaxError) return Response.json({ error: "invalid_body" }, { status: 400 });
		throw err;
	}
	const result = reviewFlashcard(input);
	if (result.ok) return Response.json({ ok: true });
	return Response.json({ error: result.error }, { status: result.status });
}
