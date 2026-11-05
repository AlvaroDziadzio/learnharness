"use client";

import { useEffect, useRef } from "react";
import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { MATERIAL_ACCEPT, MATERIAL_ERRORS, MATERIAL_EXTENSIONS } from "@/lib/material-limits.ts";

/**
 * Lesson material on the creation surfaces (owner, 2026-11-04): the
 * paperclip that picks the ONE file a teach session starts from, the draft
 * chip that shows it (with the server's refusal under it), and the drop
 * registration that lets a file dropped on the draft or home screen become
 * the material instead of a path insert. The upload itself rides the
 * session create (start-session.ts); nothing is sent before Send.
 */

export const MATERIAL_ATTACH_LABEL = "Attach lesson material (PDF, Markdown, text)";

/** Is this a file the material create accepts? (extension only — the
 *  server still detects PDFs by header and refuses what it can't read). */
export function isMaterialFile(file: { name: string }): boolean {
	return MATERIAL_EXTENSIONS.test(file.name);
}

// ─── Drop registration ────────────────────────────────────────────────────────

type MaterialDropHandler = (file: File) => void;
let dropHandler: MaterialDropHandler | null = null;

/** The global drop zone's question: does a mounted creation surface take a
 *  dropped material file right now? Exactly one supported file qualifies;
 *  any other drop keeps the path-insert behavior. */
export function materialDropTarget(files: readonly File[]): MaterialDropHandler | null {
	return dropHandler && files.length === 1 && isMaterialFile(files[0]!) ? dropHandler : null;
}

/** Is a creation surface taking material drops right now? (the drag
 *  overlay's copy). */
export function materialDropActive(): boolean {
	return dropHandler !== null;
}

export const MATERIAL_DROP_LABEL = "Drop to attach lesson material";

/** Register the surface's handler while mounted and enabled (teach mode). */
export function useMaterialDrop(handler: MaterialDropHandler | null): void {
	const ref = useRef(handler);
	ref.current = handler;
	const enabled = handler !== null;
	useEffect(() => {
		if (!enabled) return;
		const registered: MaterialDropHandler = (file) => ref.current?.(file);
		dropHandler = registered;
		return () => {
			if (dropHandler === registered) dropHandler = null;
		};
	}, [enabled]);
}

// ─── Controls ─────────────────────────────────────────────────────────────────

/** The paperclip: opens the picker for the four types; an unsupported pick
 *  is refused on the spot (no upload). */
export function MaterialAttachControl({ onPick, onReject, disabled }: {
	onPick: (file: File) => void;
	onReject: (error: string) => void;
	disabled?: boolean;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<Hint label={MATERIAL_ATTACH_LABEL}>
				<button
					type="button"
					data-testid="material-attach"
					aria-label={MATERIAL_ATTACH_LABEL}
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
					className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-border/80 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
				>
					<PaperclipIcon aria-hidden="true" className="size-3.5" />
				</button>
			</Hint>
			<input
				ref={inputRef}
				type="file"
				accept={MATERIAL_ACCEPT}
				data-testid="material-input"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = ""; // picking the same file again must fire again
					if (!file) return;
					if (isMaterialFile(file)) onPick(file);
					else onReject(MATERIAL_ERRORS.unsupported);
				}}
			/>
		</>
	);
}

/** The attached file (or the refusal of the last attempt), with remove ×. */
export function MaterialDraftChip({ name, error, onRemove }: { name: string | null; error: string | null; onRemove: () => void }) {
	return (
		<div className="flex flex-col gap-1">
			{name && (
				<div
					data-testid="material-chip"
					className="flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1 font-ui text-xs text-foreground"
				>
					<FileTextIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
					<span className="max-w-64 truncate">{name}</span>
					<button
						type="button"
						data-testid="material-remove"
						aria-label="Remove lesson material"
						onClick={onRemove}
						className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<XIcon aria-hidden="true" className="size-3" />
					</button>
				</div>
			)}
			{error && (
				<p role="alert" data-testid="material-error" className="text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
