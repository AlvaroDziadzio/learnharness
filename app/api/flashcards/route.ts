/**
 * /api/flashcards — the browse list and the review queue (design:
 * docs/designs/flashcards.md). Thin transport over src/server/flashcards.ts.
 *
 *   GET ?q=<search>          → 200 { cards: FlashcardRecord[] } (newest first)
 *   GET ?ids=<id>,<id>       → 200 { cards: (FlashcardRecord | null)[] } (in id order)
 *   GET ?view=queue          → 200 FlashcardQueue
 *
 * Cards are created only by the teacher's tool and by extraction.
 */
import { flashcardQueue, getFlashcards, listFlashcards } from "@/src/server";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	if (params.get("view") === "queue") return Response.json(flashcardQueue(), NO_STORE);
	const ids = params.get("ids");
	if (ids !== null) return Response.json({ cards: getFlashcards(ids.split(",").filter(Boolean)) }, NO_STORE);
	return Response.json({ cards: listFlashcards(params.get("q") ?? undefined) }, NO_STORE);
}
