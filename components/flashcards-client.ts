/**
 * The browser's flashcard transport (design: docs/designs/flashcards.md):
 * thin fetch wrappers over /api/flashcards. Every call throws on a non-OK
 * response so callers show the failure instead of a silent no-op.
 */

import type { FlashcardEdit, FlashcardQueue, FlashcardRecord, FlashcardReviewInput } from "@/src/core";

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export async function fetchFlashcards(query = ""): Promise<FlashcardRecord[]> {
	const q = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
	return (await json<{ cards: FlashcardRecord[] }>(await fetch(`/api/flashcards${q}`))).cards;
}

export async function fetchFlashcardsById(ids: readonly string[]): Promise<(FlashcardRecord | null)[]> {
	if (!ids.length) return [];
	const res = await fetch(`/api/flashcards?ids=${ids.map(encodeURIComponent).join(",")}`);
	return (await json<{ cards: (FlashcardRecord | null)[] }>(res)).cards;
}

export async function fetchFlashcardQueue(): Promise<FlashcardQueue> {
	return json<FlashcardQueue>(await fetch("/api/flashcards?view=queue"));
}

export async function saveFlashcard(id: string, edit: FlashcardEdit): Promise<FlashcardRecord> {
	return json<FlashcardRecord>(
		await fetch(`/api/flashcards/${encodeURIComponent(id)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(edit),
		}),
	);
}

export async function removeFlashcard(id: string): Promise<void> {
	await json<{ ok: true }>(await fetch(`/api/flashcards/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function sendFlashcardReview(input: FlashcardReviewInput): Promise<void> {
	await json<{ ok: true }>(
		await fetch("/api/flashcards/review", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input }),
		}),
	);
}
