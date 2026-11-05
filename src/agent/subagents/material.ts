import type { MaterialOutlineEntry, MaterialUnit, SessionMaterial } from "../../core/contracts.ts";
import {
	MATERIAL_ERRORS,
	MATERIAL_EXTENSIONS,
	MATERIAL_SECTION_CHARS,
	MAX_MATERIAL_BYTES,
	MAX_MATERIAL_PAGES,
	partialScanNotice,
} from "../../../lib/material-limits.ts";
import { pdfMaterial } from "./pdf-ops.ts";

/**
 * Lesson material conversion (owner, 2026-11-04): one uploaded file becomes
 * numbered units the material tools read, plus the record's metadata (the
 * outline the system prompt carries). PDFs — spotted by their %PDF- header,
 * as in notes import — read by page through pdf-ops; Markdown and text read
 * by numbered section, split at #/## headings, with an over-long section
 * cut on a paragraph boundary. Pure apart from the pdfjs parse: nothing is
 * written here (the route stores the result).
 */

export type MaterialConversion =
	| { kind: "converted"; material: SessionMaterial; units: MaterialUnit[]; extension: string; notice?: string }
	| { kind: "refused"; error: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

export async function convertMaterial(bytes: Uint8Array, filename: string): Promise<MaterialConversion> {
	if (!MATERIAL_EXTENSIONS.test(filename)) return { kind: "refused", error: MATERIAL_ERRORS.unsupported };
	if (bytes.byteLength > MAX_MATERIAL_BYTES) return { kind: "refused", error: MATERIAL_ERRORS.tooBig };
	const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
	const isPdf = PDF_MAGIC.every((byte, i) => bytes[i] === byte);
	if (isPdf) return convertPdfMaterial(bytes, filename);
	if (extension === "pdf") return { kind: "refused", error: MATERIAL_ERRORS.unreadable };
	return convertText(new TextDecoder().decode(bytes), filename, bytes.byteLength, extension);
}

async function convertPdfMaterial(bytes: Uint8Array, filename: string): Promise<MaterialConversion> {
	const pdf = await pdfMaterial(bytes, MAX_MATERIAL_PAGES);
	if (pdf.kind === "unreadable") return { kind: "refused", error: MATERIAL_ERRORS.unreadable };
	if (pdf.kind === "too-long") return { kind: "refused", error: MATERIAL_ERRORS.tooLong };
	const units = pdf.pages.map((p) => ({ n: p.number, text: p.kind === "text" ? p.markdown : "" }));
	if (units.every((u) => !u.text)) return { kind: "refused", error: MATERIAL_ERRORS.scanned };
	const imageOnly = pdf.pages.filter((p) => p.kind === "image-only").map((p) => p.number);
	// Bookmarks are the author's own table of contents; without them, the
	// headings the Markdown conversion found stand in.
	const outline: MaterialOutlineEntry[] = pdf.bookmarks.length > 0
		? pdf.bookmarks.map((b) => ({ title: b.title, level: b.level, at: b.page }))
		: units.flatMap((u) => headingsOf(u.text).map((h) => ({ ...h, at: u.n })));
	const material: SessionMaterial = {
		name: filename,
		mediaType: "pdf",
		bytes: bytes.byteLength,
		unit: "page",
		count: units.length,
		imageOnly,
		outline,
		// The pdf-read.ts flaggedPages rule: math- or image-heavy pages.
		flagged: pdf.info.filter((p) => p.math_density >= 0.03 || p.image_count > 0).map((p) => p.page),
	};
	return {
		kind: "converted",
		material,
		units,
		extension: "pdf",
		...(imageOnly.length > 0 ? { notice: partialScanNotice(imageOnly.length) } : {}),
	};
}

function convertText(text: string, filename: string, bytes: number, extension: string): MaterialConversion {
	if (!text.trim()) return { kind: "refused", error: MATERIAL_ERRORS.empty };
	const sections = splitSections(text);
	const units = sections.map((body, i) => ({ n: i + 1, text: body }));
	const material: SessionMaterial = {
		name: filename,
		mediaType: extension === "txt" ? "text" : "markdown",
		bytes,
		unit: "section",
		count: units.length,
		imageOnly: [],
		outline: units.flatMap((u) => headingsOf(u.text).map((h) => ({ ...h, at: u.n }))),
		flagged: [],
	};
	return { kind: "converted", material, units, extension };
}

/** Headings (levels 1-3) outside fenced code, in order. */
function headingsOf(markdown: string): { title: string; level: number }[] {
	const out: { title: string; level: number }[] = [];
	let fenced = false;
	for (const line of markdown.split("\n")) {
		if (FENCE.test(line)) fenced = !fenced;
		if (fenced) continue;
		const m = HEADING.exec(line);
		if (m && m[1]!.length <= 3) out.push({ title: m[2]!, level: m[1]!.length });
	}
	return out;
}

/** Split at #/## headings outside fenced code; then cut any section longer
 *  than the cap. Blank stretches (e.g. text before the first heading that
 *  is only whitespace) never become sections. */
export function splitSections(text: string): string[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const raw: string[][] = [[]];
	let fenced = false;
	for (const line of lines) {
		if (FENCE.test(line)) fenced = !fenced;
		const m = fenced ? null : HEADING.exec(line);
		if (m && m[1]!.length <= 2 && raw.at(-1)!.some((l) => l.trim())) raw.push([]);
		raw.at(-1)!.push(line);
	}
	return raw
		.map((s) => s.join("\n").trim())
		.filter(Boolean)
		.flatMap((s) => cutSection(s, MATERIAL_SECTION_CHARS));
}

/** Cut on paragraph boundaries; a single paragraph over the cap is cut hard. */
function cutSection(section: string, cap: number): string[] {
	if (section.length <= cap) return [section];
	const out: string[] = [];
	let current = "";
	for (const paragraph of section.split(/\n{2,}/)) {
		const pieces = paragraph.length > cap
			? Array.from({ length: Math.ceil(paragraph.length / cap) }, (_, i) => paragraph.slice(i * cap, (i + 1) * cap))
			: [paragraph];
		for (const piece of pieces) {
			if (current && current.length + 2 + piece.length > cap) {
				out.push(current);
				current = piece;
			} else {
				current = current ? `${current}\n\n${piece}` : piece;
			}
		}
	}
	if (current) out.push(current);
	return out;
}
