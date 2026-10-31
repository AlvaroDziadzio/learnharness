/**
 * /api/flashcards/:id — edit or delete one card (design:
 * docs/designs/flashcards.md).
 *
 *   PATCH { front, back } → 200 FlashcardRecord | 400 invalid_body | 404 card_not_found
 *   DELETE                → 200 { ok: true } | 404 card_not_found
 */
import { FlashcardInputError, parseFlashcardEdit } from "@/src/core";
import { deleteFlashcard, editFlashcard } from "@/src/server";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	let edit;
	try {
		edit = parseFlashcardEdit(await req.json());
	} catch (err) {
		if (err instanceof FlashcardInputError || err instanceof SyntaxError) return Response.json({ error: "invalid_body" }, { status: 400 });
		throw err;
	}
	const card = editFlashcard(id, edit);
	if (!card) return Response.json({ error: "card_not_found" }, { status: 404 });
	return Response.json(card);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!deleteFlashcard(id)) return Response.json({ error: "card_not_found" }, { status: 404 });
	return Response.json({ ok: true });
}
