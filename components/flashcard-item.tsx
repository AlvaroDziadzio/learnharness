"use client";

import { useState, type ReactNode } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { removeFlashcard, saveFlashcard } from "@/components/flashcards-client";
import type { FlashcardRecord } from "@/src/core";

/**
 * One stored flashcard with Edit and Delete (design:
 * docs/designs/flashcards.md) — shared by the transcript card and the
 * browse list. Saves go straight to the server; the `flashcards-changed`
 * event refreshes every view showing the card, so this component keeps no
 * copy beyond the open editor's draft.
 */
export function FlashcardItem({ card, footer }: { card: FlashcardRecord; footer?: ReactNode }) {
	const [draft, setDraft] = useState<{ front: string; back: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			setDraft(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	if (draft) {
		const blank = !draft.front.trim() || !draft.back.trim();
		return (
			<div data-testid="flashcard-item-editing" className="space-y-2 rounded-lg bg-background/60 p-3">
				<Textarea aria-label="Front" value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })} />
				<Textarea aria-label="Back" value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} />
				{error && <p className="text-xs text-destructive">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
						Cancel
					</Button>
					<Button size="xs" disabled={busy || blank} onClick={() => void run(() => saveFlashcard(card.id, draft))}>
						Save
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div data-testid="flashcard-item" className="group rounded-lg bg-background/60 px-3 py-2">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1 space-y-1">
					<div className="text-sm font-medium">
						<ToolContentResponse>{card.front}</ToolContentResponse>
					</div>
					<div className="text-sm text-muted-foreground">
						<ToolContentResponse>{card.back}</ToolContentResponse>
					</div>
				</div>
				<div className="flex shrink-0 gap-0.5">
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Edit flashcard"
						disabled={busy}
						onClick={() => setDraft({ front: card.front, back: card.back })}
					>
						<PencilIcon />
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Delete flashcard"
						disabled={busy}
						onClick={() => void run(() => removeFlashcard(card.id))}
					>
						<Trash2Icon />
					</Button>
				</div>
			</div>
			{footer}
			{error && <p className="mt-1 text-xs text-destructive">{error}</p>}
		</div>
	);
}
