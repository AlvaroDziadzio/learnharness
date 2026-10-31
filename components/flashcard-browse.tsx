"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FlashcardItem } from "@/components/flashcard-item";
import { fetchFlashcards } from "@/components/flashcards-client";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { Input } from "@/components/ui/input";
import type { ChatSummary, FlashcardRecord } from "@/src/core";

/**
 * The browse list (design: docs/designs/flashcards.md): every card, newest
 * first, searchable, each with Edit/Delete, an "auto" or "requested" tag and
 * a link to its source session. A session that no longer exists shows as
 * "deleted session" — its cards stay.
 */
export function FlashcardBrowse() {
	const [query, setQuery] = useState("");
	const [cards, setCards] = useState<FlashcardRecord[] | null>(null);
	const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		Promise.all([
			fetchFlashcards(query),
			fetch("/api/chats").then(async (res) => (res.ok ? ((await res.json()) as { chats: ChatSummary[] }).chats : [])),
		]).then(
			([next, chats]) => {
				setCards(next);
				setTitles(new Map(chats.map((c) => [c.id, c.title])));
				setError(null);
			},
			(err: unknown) => setError(err instanceof Error ? err.message : String(err)),
		);
	}, [query]);
	useEffect(load, [load]);
	useServerEvent("flashcards-changed", load);
	useServerResync(load);

	return (
		<div className="flex flex-col gap-3">
			<Input
				data-testid="flashcard-search"
				placeholder="Search cards"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>
			{error && <p className="text-sm text-destructive">{error}</p>}
			{cards === null ? (
				<p className="text-sm text-muted-foreground">Loading…</p>
			) : cards.length === 0 ? (
				<p className="text-sm text-muted-foreground">{query.trim() ? "No cards match." : "No flashcards yet."}</p>
			) : (
				<div data-testid="flashcard-list" className="flex flex-col gap-2">
					{cards.map((card) => {
						const title = titles.get(card.origin.chatId);
						return (
							<FlashcardItem
								key={card.id}
								card={card}
								footer={
									<div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
										<span className="rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">
											{card.origin.kind === "extraction" ? "auto" : "requested"}
										</span>
										{title ? (
											<Link href={`/chat/${card.origin.chatId}`} className="truncate hover:text-foreground hover:underline">
												{title}
											</Link>
										) : (
											<span className="italic">deleted session</span>
										)}
									</div>
								}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}
