"use client";

import { useCallback, useEffect, useState } from "react";
import { LayersIcon } from "lucide-react";
import { FlashcardItem } from "@/components/flashcard-item";
import { fetchFlashcardsById } from "@/components/flashcards-client";
import { useServerEvent } from "@/components/server-events";
import type { ArtifactPartProps, FlashcardRecord } from "@/src/core";

/** The tool's record-facing result (src/agent/tools/flashcard.ts). */
function cardIdsOf(output: unknown): string[] | null {
	const ids = (output as { cardIds?: unknown } | null | undefined)?.cardIds;
	return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : null;
}

/** The call's own arguments — the fallback when the store can't be read. */
function inputCardsOf(input: unknown): { front: string; back: string }[] {
	const cards = (input as { cards?: unknown } | null | undefined)?.cards;
	if (!Array.isArray(cards)) return [];
	return cards.filter(
		(c): c is { front: string; back: string } => typeof c?.front === "string" && typeof c?.back === "string",
	);
}

/**
 * The teacher's `flashcard` call in the transcript (design:
 * docs/designs/flashcards.md, D6): the cards as they are NOW in the store —
 * looked up by the result's ids, refetched on `flashcards-changed` — so
 * edits show and a deleted card says so. If the lookup fails, the call's
 * own arguments render read-only.
 */
export function FlashcardCard({ part }: ArtifactPartProps) {
	const ids = cardIdsOf(part.output);
	const idsKey = ids?.join(",") ?? "";
	const [cards, setCards] = useState<(FlashcardRecord | null)[] | null>(null);
	const [failed, setFailed] = useState(false);

	const load = useCallback(() => {
		if (!idsKey) return;
		fetchFlashcardsById(idsKey.split(",")).then(
			(next) => {
				setCards(next);
				setFailed(false);
			},
			() => setFailed(true),
		);
	}, [idsKey]);
	useEffect(load, [load]);
	useServerEvent("flashcards-changed", load);

	if (part.state === "output-error") return null;
	const fallback = inputCardsOf(part.input);
	const count = ids?.length ?? fallback.length;

	return (
		<div data-testid="flashcard-card" className="my-3 rounded-xl border bg-card/60 p-3">
			<div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				<LayersIcon className="size-3.5 text-primary" />
				{ids ? `${count} flashcard${count === 1 ? "" : "s"} added` : "Adding flashcards…"}
			</div>
			<div className="space-y-2">
				{cards && !failed
					? cards.map((card, i) =>
							card ? (
								<FlashcardItem key={card.id} card={card} />
							) : (
								<p key={ids?.[i] ?? i} className="rounded-lg bg-background/60 px-3 py-2 text-sm text-muted-foreground italic">
									Deleted
								</p>
							),
						)
					: fallback.map((c, i) => (
							<div key={i} className="rounded-lg bg-background/60 px-3 py-2 text-sm">
								<div className="font-medium">{c.front}</div>
								<div className="text-muted-foreground">{c.back}</div>
							</div>
						))}
			</div>
		</div>
	);
}
