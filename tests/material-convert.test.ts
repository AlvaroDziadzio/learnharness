/**
 * Lesson material conversion (owner, 2026-11-04): one uploaded file becomes
 * numbered units plus the record's metadata. PDFs read by page (detected
 * by header), Markdown/text by section (split at #/##, cut when long).
 * Every refusal is the attach error the draft chip shows.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { convertMaterial, splitSections } from "../src/agent/subagents/material.ts";
import { MATERIAL_ERRORS, MATERIAL_SECTION_CHARS, partialScanNotice } from "../lib/material-limits.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("convertMaterial — PDFs", () => {
	it("reads the fixture by page, keeps the caller's bytes, and records page metadata", async () => {
		const bytes = new Uint8Array(fs.readFileSync("tests/fixtures/sample-3page.pdf"));
		const size = bytes.byteLength;
		const out = await convertMaterial(bytes, "sample.pdf");
		assert.equal(out.kind, "converted");
		if (out.kind !== "converted") return;
		assert.equal(bytes.byteLength, size, "pdfjs must not detach the original bytes the route stores");
		assert.equal(out.extension, "pdf");
		assert.deepEqual(
			{ name: out.material.name, mediaType: out.material.mediaType, bytes: out.material.bytes, unit: out.material.unit, count: out.material.count },
			{ name: "sample.pdf", mediaType: "pdf", bytes: size, unit: "page", count: 3 },
		);
		assert.deepEqual(out.units.map((u) => u.n), [1, 2, 3]);
		assert.match(out.units[1]!.text, /force equals mass times acceleration/);
		assert.equal(out.notice, undefined);
	});

	it("falls back to converted headings for the outline when there are no bookmarks", async () => {
		const pdf = tinyPdf([
			{ runs: [{ text: "Chapter One", x: 72, y: 720, size: 24 }, { text: "Body text on the first page.", x: 72, y: 680, size: 11 }] },
			{ runs: [{ text: "Chapter Two", x: 72, y: 720, size: 24 }, { text: "More body text here.", x: 72, y: 680, size: 11 }] },
		]);
		const out = await convertMaterial(pdf, "book.pdf");
		assert.equal(out.kind, "converted");
		if (out.kind !== "converted") return;
		assert.deepEqual(out.material.outline, [
			{ title: "Chapter One", level: 1, at: 1 },
			{ title: "Chapter Two", level: 1, at: 2 },
		]);
	});

	it("accepts a partial scan with a notice and flags its image-only pages", async () => {
		const pdf = tinyPdf([{ runs: [{ text: "Readable page.", x: 72, y: 700 }] }, { image: true }]);
		const out = await convertMaterial(pdf, "scan.pdf");
		assert.equal(out.kind, "converted");
		if (out.kind !== "converted") return;
		assert.deepEqual(out.material.imageOnly, [2]);
		assert.equal(out.units[1]!.text, "");
		assert.equal(out.notice, partialScanNotice(1));
	});

	it("refuses a fully scanned PDF, an unreadable one, and a .pdf that is not a PDF", async () => {
		assert.deepEqual(await convertMaterial(tinyPdf([{ image: true }, { image: true }]), "scan.pdf"), { kind: "refused", error: MATERIAL_ERRORS.scanned });
		assert.deepEqual(await convertMaterial(enc("%PDF-1.4 garbage"), "broken.pdf"), { kind: "refused", error: MATERIAL_ERRORS.unreadable });
		assert.deepEqual(await convertMaterial(enc("plain text"), "fake.pdf"), { kind: "refused", error: MATERIAL_ERRORS.unreadable });
	});
});

describe("convertMaterial — Markdown and text", () => {
	it("splits at #/## outside fences and outlines headings to level 3 by section", async () => {
		const out = await convertMaterial(enc("intro\n\n# A\ntext\n```\n# not a heading\n```\n## B\nmore\n### C\nx"), "notes.md");
		assert.equal(out.kind, "converted");
		if (out.kind !== "converted") return;
		assert.equal(out.material.mediaType, "markdown");
		assert.equal(out.material.unit, "section");
		assert.deepEqual(out.units.map((u) => u.text), ["intro", "# A\ntext\n```\n# not a heading\n```", "## B\nmore\n### C\nx"]);
		assert.deepEqual(out.material.outline, [
			{ title: "A", level: 1, at: 2 },
			{ title: "B", level: 2, at: 3 },
			{ title: "C", level: 3, at: 3 },
		]);
	});

	it("reads .txt as text with numbered sections", async () => {
		const out = await convertMaterial(enc("just some notes"), "notes.txt");
		assert.equal(out.kind, "converted");
		if (out.kind !== "converted") return;
		assert.equal(out.material.mediaType, "text");
		assert.equal(out.material.count, 1);
	});

	it("cuts an over-long section on paragraph boundaries, and a giant paragraph hard", () => {
		const para = "word ".repeat(400).trim(); // ~2,000 chars
		const sections = splitSections(Array.from({ length: 10 }, () => para).join("\n\n"));
		assert.ok(sections.length > 1);
		assert.ok(sections.every((s) => s.length <= MATERIAL_SECTION_CHARS));
		const giant = splitSections("x".repeat(MATERIAL_SECTION_CHARS * 2 + 5));
		assert.deepEqual(giant.map((s) => s.length), [MATERIAL_SECTION_CHARS, MATERIAL_SECTION_CHARS, 5]);
	});

	it("refuses empty files and unsupported types", async () => {
		assert.deepEqual(await convertMaterial(enc("  \n\t"), "empty.md"), { kind: "refused", error: MATERIAL_ERRORS.empty });
		assert.deepEqual(await convertMaterial(enc("hello"), "notes.docx"), { kind: "refused", error: MATERIAL_ERRORS.unsupported });
	});
});
