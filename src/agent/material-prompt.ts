import type { SessionMaterial } from "../core/contracts.ts";
import { MATERIAL_OUTLINE_CHARS } from "../../lib/material-limits.ts";

/**
 * The lesson-material appendix of the system prompt (owner, 2026-11-04 —
 * Q16): what the material is, its table of contents with page/section
 * numbers, and which units need visual reading. Built from the record's
 * material field every turn — it never changes within a session, so the
 * prompt stays cache-stable, and compaction can never drop it. Capped at
 * MATERIAL_OUTLINE_CHARS: deeper levels go first, then the tail.
 */
export function materialOutlinePrompt(material: SessionMaterial, storedPath: string | null): string {
	const pdf = material.unit === "page";
	const at = (n: number) => (pdf ? `p. ${n}` : `§${n}`);
	const kind = material.mediaType === "pdf" ? "PDF" : material.mediaType === "markdown" ? "Markdown" : "Text";
	const head = [
		"# Lesson material",
		"",
		`The learner attached: ${material.name} (${kind}, ${material.count} ${material.unit}${material.count === 1 ? "" : "s"}).`,
		...(pdf && storedPath ? [`Stored at: ${storedPath} (for the \`pdf\` job only)`] : []),
	];
	const tail = [
		...(material.flagged.length > 0 ? ["", `Math/image-heavy pages: ${material.flagged.join(", ")}`] : []),
		...(material.imageOnly.length > 0
			? ["", `Image-only pages (text tools see nothing; read visually): ${material.imageOnly.join(", ")}`]
			: []),
	];
	const budget = MATERIAL_OUTLINE_CHARS - [...head, ...tail].join("\n").length;
	return [...head, "", ...contentsLines(material, at, budget), ...tail].join("\n");
}

function contentsLines(material: SessionMaterial, at: (n: number) => string, budget: number): string[] {
	if (material.outline.length === 0) {
		return ["Contents: no headings found — use material_search to find your way."];
	}
	const lineFor = (e: SessionMaterial["outline"][number]) => `${"  ".repeat(Math.max(0, e.level - 1))}- ${e.title} — ${at(e.at)}`;
	const fits = (lines: string[]) => lines.join("\n").length <= budget;
	for (const depth of [Infinity, 2, 1]) {
		const lines = ["Contents:", ...material.outline.filter((e) => e.level <= depth).map(lineFor)];
		if (fits(lines)) return lines;
	}
	const marker = "…[outline truncated — use material_search]";
	const lines = ["Contents:"];
	for (const e of material.outline.filter((e) => e.level <= 1)) {
		if (!fits([...lines, lineFor(e), marker])) break;
		lines.push(lineFor(e));
	}
	return [...lines, marker];
}
