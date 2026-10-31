"use client";

import Link from "next/link";
import { XIcon } from "lucide-react";

/** "3 flashcards added · Review" above the composer (design:
 *  docs/designs/flashcards.md, D5) — for auto-cards from this session's
 *  extraction. Dismissible; never persisted. */
export function FlashcardNotice({ count, onDismiss }: { count: number; onDismiss: () => void }) {
	return (
		<div data-testid="flashcard-notice" className="mb-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
			<span>
				{count} flashcard{count === 1 ? "" : "s"} added ·{" "}
				<Link href="/review" className="text-foreground hover:underline">
					Review
				</Link>
			</span>
			<button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded p-0.5 hover:bg-accent hover:text-foreground">
				<XIcon className="size-3" />
			</button>
		</div>
	);
}
