"use client";

import { useEffect, useState, type RefObject } from "react";
import { LayersIcon } from "lucide-react";

/** The learner's request, sent as an ordinary message (design:
 *  docs/designs/flashcards.md, Prompts §3). */
export function flashcardRequestText(selection: string): string {
	const quoted = selection
		.trim()
		.split("\n")
		.map((line) => (line.trim() ? `> ${line}` : ">"))
		.join("\n");
	return `Make flashcards from this passage:\n\n${quoted}`;
}

/** The selection's text and anchor rect when it lies wholly inside one
 *  assistant message under `root`; null otherwise. */
function assistantSelection(root: HTMLElement): { text: string; rect: DOMRect } | null {
	const sel = root.ownerDocument.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const text = sel.toString();
	if (!text.trim()) return null;
	const elementOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement ?? null);
	const anchor = elementOf(sel.anchorNode)?.closest(".is-assistant");
	const focus = elementOf(sel.focusNode)?.closest(".is-assistant");
	if (!anchor || anchor !== focus || !root.contains(anchor)) return null;
	return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
}

/**
 * The floating "Make flashcard" button over selected assistant prose
 * (design: docs/designs/flashcards.md, D2/D3). Shown only while `enabled`
 * (teaching sessions past the probe); clicking sends the fixed request
 * template through `onRequest`, which sends or steers like the composer.
 */
export function SelectionFlashcard({
	root,
	enabled,
	onRequest,
}: {
	root: RefObject<HTMLElement | null>;
	enabled: boolean;
	onRequest: (text: string) => void;
}) {
	const [hit, setHit] = useState<{ text: string; top: number; left: number } | null>(null);

	useEffect(() => {
		if (!enabled) {
			setHit(null);
			return;
		}
		const update = () => {
			const el = root.current;
			const found = el ? assistantSelection(el) : null;
			setHit(found ? { text: found.text, top: found.rect.top, left: found.rect.left + found.rect.width / 2 } : null);
		};
		document.addEventListener("selectionchange", update);
		window.addEventListener("scroll", update, true);
		return () => {
			document.removeEventListener("selectionchange", update);
			window.removeEventListener("scroll", update, true);
		};
	}, [enabled, root]);

	if (!hit) return null;
	return (
		<button
			type="button"
			data-testid="selection-flashcard"
			// Keep the selection: a mousedown on the button would collapse it.
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => {
				onRequest(flashcardRequestText(hit.text));
				document.getSelection()?.removeAllRanges();
				setHit(null);
			}}
			style={{ position: "fixed", top: Math.max(8, hit.top - 36), left: hit.left, transform: "translateX(-50%)" }}
			className="z-50 flex items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md hover:bg-accent"
		>
			<LayersIcon className="size-3" />
			Make flashcard
		</button>
	);
}
