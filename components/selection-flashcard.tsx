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

/** What to do with Make flashcard requests queued while a question waited
 *  for its answer: hold them while it still waits; steer them into the turn
 *  the answer starts (and hold until it starts); after a dismissal no turn
 *  comes, so send them as an ordinary message. */
export function queuedFlashcardAction(s: {
	queued: number;
	pending: boolean;
	busy: boolean;
	compacting: boolean;
	answering: boolean;
}): "wait" | "steer" | "send" {
	if (s.queued === 0 || s.pending) return "wait";
	if (s.busy) return "steer";
	if (s.answering || s.compacting) return "wait";
	return "send";
}

/** The selection's text and rect within one assistant message under
 *  `root`; null otherwise. An end that spills outside the message (a
 *  triple-click selects up to the next block) is trimmed to the message;
 *  a selection spanning two messages is refused. */
function assistantSelection(root: HTMLElement): { text: string; rect: DOMRect } | null {
	const sel = root.ownerDocument.getSelection();
	if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	const messageOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest(".is-assistant") ?? null;
	const startMessage = messageOf(range.startContainer);
	const endMessage = messageOf(range.endContainer);
	const message = startMessage ?? endMessage;
	if (!message || !root.contains(message)) return null;
	if (startMessage && endMessage && startMessage !== endMessage) return null;
	const trimmed = range.cloneRange();
	if (!startMessage) trimmed.setStart(message, 0);
	if (!endMessage) trimmed.setEnd(message, message.childNodes.length);
	const text = trimmed.toString();
	if (!text.trim()) return null;
	return { text, rect: trimmed.getBoundingClientRect() };
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
