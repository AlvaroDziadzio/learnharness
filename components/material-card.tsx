"use client";

import { FileTextIcon } from "lucide-react";
import type { MaterialCardData } from "@/src/core";
import { Hint } from "@/components/ui/hint";

/**
 * Lesson material in the session (owner, 2026-11-04): the transcript card
 * above the first bubble (the material marker's details — the
 * graph-context card's register) and the header chip that opens the
 * original file in a new tab (GET /api/chats/[id]/material).
 */

export const MATERIAL_OPEN_LABEL = "Open lesson material";

function typeLabel(data: Pick<MaterialCardData, "mediaType">): string {
	return data.mediaType === "pdf" ? "PDF" : data.mediaType === "markdown" ? "Markdown" : "Text";
}

export function MaterialCard({ data }: { data: MaterialCardData }) {
	const { name = "", count = 0, unit = "page", notice } = data ?? {};
	return (
		<div data-testid="material-card" className="my-1">
			<div className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
				<FileTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 truncate font-medium text-foreground/80">{name}</span>
				<span className="shrink-0">
					{typeLabel(data)} · {count} {unit}{count === 1 ? "" : "s"}
				</span>
			</div>
			{notice && (
				<p data-testid="material-card-notice" className="mt-1 px-1 text-xs text-muted-foreground">
					{notice}
				</p>
			)}
		</div>
	);
}

export function MaterialHeaderChip({ chatId, name }: { chatId: string; name: string }) {
	return (
		<Hint label={MATERIAL_OPEN_LABEL} side="bottom">
			<a
				href={`/api/chats/${encodeURIComponent(chatId)}/material`}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="material-chip-header"
				aria-label={`${MATERIAL_OPEN_LABEL}: ${name}`}
				className="lh-no-drag flex min-w-0 max-w-56 shrink cursor-pointer items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
			>
				<FileTextIcon className="size-3.5 shrink-0" aria-hidden />
				<span className="truncate">{name}</span>
			</a>
		</Hint>
	);
}
