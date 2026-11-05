import { IMPORT_EXTENSIONS, MAX_IMPORT_BODY_BYTES, MAX_IMPORT_BYTES } from "./notes-import-limits.ts";

/** Lesson material (owner, 2026-11-04): the same file types and byte limits
 *  as notes import — one list of what the app reads, one size rule. */
export const MATERIAL_EXTENSIONS = IMPORT_EXTENSIONS;
export const MAX_MATERIAL_BYTES = MAX_IMPORT_BYTES;
export const MAX_MATERIAL_BODY_BYTES = MAX_IMPORT_BODY_BYTES;
/** The picker's accept list (MATERIAL_EXTENSIONS, spelled for <input>). */
export const MATERIAL_ACCEPT = ".pdf,.md,.markdown,.txt";
export const MAX_MATERIAL_PAGES = 1000;
/** A text section longer than this is cut on a paragraph boundary. */
export const MATERIAL_SECTION_CHARS = 8000;
/** The outline prompt's ceiling (~2,000 tokens). */
export const MATERIAL_OUTLINE_CHARS = 8000;

/** Refusal copy, shown under the draft chip. */
export const MATERIAL_ERRORS = {
	unsupported: "Unsupported file type.",
	tooBig: "Too big. Max 25 MB.",
	unreadable: "Could not open this PDF.",
	tooLong: "Too long. Max 1,000 pages.",
	scanned: "OCR not supported yet.",
	empty: "This file is empty.",
} as const;

/** The partial-scan notice (notes import's wording, adapted: the pages are
 *  not skipped — they can still be read visually). */
export function partialScanNotice(imageOnly: number): string {
	return `Scanned pages may have errors. ${imageOnly} image-only ${imageOnly === 1 ? "page" : "pages"} can only be read visually.`;
}
