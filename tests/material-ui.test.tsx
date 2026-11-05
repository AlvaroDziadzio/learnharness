import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DraftShell, startDraftSession } from "../components/new-session.tsx";
import { readOpeningPrompt } from "../components/opening-prompt.ts";
import { MaterialRefusedError, SessionStarter } from "../components/start-session.ts";
import { MATERIAL_ATTACH_LABEL, isMaterialFile, materialDropActive, materialDropTarget } from "../components/material-attach.tsx";
import { MaterialCard, MaterialHeaderChip } from "../components/material-card.tsx";
import { MATERIAL_OPENING_TEXT, newMaterialMessage, projectView, type SessionMaterial } from "../src/core/index.ts";

/**
 * Lesson material on screen (owner, 2026-11-04): the draft's paperclip and
 * chip (teach only), the material-only start (fixed opening text, title
 * from the filename server-side), the server's refusal kept under the chip,
 * the transcript card, and the header chip's new-tab link.
 */

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
beforeEach(() => {
	const data = new Map<string, string>();
	Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => { data.set(key, value); },
		removeItem: (key: string) => { data.delete(key); },
	} });
});
afterEach(() => {
	if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "sessionStorage");
});

const META: SessionMaterial = { name: "lecture.pdf", mediaType: "pdf", bytes: 10, unit: "page", count: 12, imageOnly: [], outline: [], flagged: [] };
const file = () => new File(["%PDF-"], "lecture.pdf", { type: "application/pdf" });

function recordingFetch(response: Response) {
	const calls: { body: BodyInit | null | undefined; headers: HeadersInit | undefined }[] = [];
	const f = (async (_url: string, init?: RequestInit) => {
		calls.push({ body: init?.body, headers: init?.headers });
		return response;
	}) as typeof fetch;
	return { f, calls };
}

describe("startDraftSession with material", () => {
	it("uploads multipart with an empty title and stashes the fixed opening text", async () => {
		const { f, calls } = recordingFetch(new Response(JSON.stringify({ id: "c_mat" }), { status: 200 }));
		const target = await startDraftSession("   ", f, undefined, undefined, new SessionStarter(), undefined, file());
		assert.equal(target, "/chat/c_mat");
		const body = calls[0]!.body as FormData;
		assert.ok(body instanceof FormData);
		assert.equal(body.get("title"), "");
		assert.equal((body.get("file") as File).name, "lecture.pdf");
		assert.equal(calls[0]!.headers, undefined, "the browser sets the multipart boundary");
		assert.equal(readOpeningPrompt("c_mat"), MATERIAL_OPENING_TEXT);
	});

	it("a typed message is both the title and the opening", async () => {
		const { f, calls } = recordingFetch(new Response(JSON.stringify({ id: "c_typed" }), { status: 200 }));
		await startDraftSession("only chapter 2, for my exam", f, undefined, undefined, new SessionStarter(), undefined, file());
		assert.equal((calls[0]!.body as FormData).get("title"), "only chapter 2, for my exam");
		assert.equal(readOpeningPrompt("c_typed"), "only chapter 2, for my exam");
	});

	it("turns a 4xx refusal into MaterialRefusedError with the server's message", async () => {
		const { f } = recordingFetch(new Response(JSON.stringify({ error: "OCR not supported yet." }), { status: 422 }));
		await assert.rejects(
			startDraftSession("", f, undefined, undefined, new SessionStarter(), undefined, file()),
			(err: unknown) => err instanceof MaterialRefusedError && err.message === "OCR not supported yet.",
		);
	});

	it("practice ignores material and still needs text", async () => {
		const { f, calls } = recordingFetch(new Response(JSON.stringify({ id: "c_p" }), { status: 200 }));
		assert.equal(await startDraftSession("", f, "practice", [], new SessionStarter(), undefined, file()), null);
		assert.equal(calls.length, 0);
	});
});

describe("DraftShell — the paperclip and chip", () => {
	const base = { busy: false, text: "", onChange: () => {}, onSend: () => {} };
	it("teach drafts carry the attach control; the chip and its error show", () => {
		const html = renderToStaticMarkup(
			<DraftShell {...base} material={file()} materialError="Too long. Max 1,000 pages." onMaterialPick={() => {}} onMaterialReject={() => {}} onMaterialRemove={() => {}} />,
		);
		assert.ok(html.includes('data-testid="material-attach"'));
		assert.ok(html.includes(`aria-label="${MATERIAL_ATTACH_LABEL}"`));
		assert.ok(html.includes('accept=".pdf,.md,.markdown,.txt"'));
		assert.match(html, /data-testid="material-chip"[^]*lecture\.pdf/);
		assert.match(html, /data-testid="material-error"[^>]*>Too long\. Max 1,000 pages\./);
		assert.ok(html.includes('aria-label="Send"'));
		assert.ok(!/aria-label="Send" disabled=""/.test(html), "material alone makes the draft sendable");
		const empty = renderToStaticMarkup(<DraftShell {...base} onMaterialPick={() => {}} />);
		assert.ok(/aria-label="Send" disabled=""/.test(empty), "without text or material the send stays disabled");
	});

	it("practice drafts never show it", () => {
		const html = renderToStaticMarkup(<DraftShell {...base} mode="practice" material={file()} onMaterialPick={() => {}} />);
		assert.ok(!html.includes("material-attach"));
		assert.ok(!html.includes("material-chip"));
	});
});

describe("drop routing", () => {
	it("no surface registered → every drop stays a path insert", () => {
		assert.equal(materialDropActive(), false);
		assert.equal(materialDropTarget([file()]), null);
	});
	it("supported types only", () => {
		assert.deepEqual(["a.pdf", "b.MD", "c.markdown", "d.txt", "e.docx", "f"].map((name) => isMaterialFile({ name })), [true, true, true, true, false, false]);
	});
});

describe("in the session", () => {
	it("the material marker projects to a user-side card above the first bubble", () => {
		const view = projectView([newMaterialMessage(META, "Scanned pages may have errors. 1 image-only page can only be read visually.")]);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		assert.equal(view[0]!.parts[0]!.type, "data-material");
		const html = renderToStaticMarkup(<MaterialCard data={view[0]!.parts[0]!.data as never} />);
		assert.match(html, /lecture\.pdf[^]*PDF · 12 pages/);
		assert.match(html, /data-testid="material-card-notice"[^>]*>Scanned pages may have errors\./);
	});

	it("the marker tells the model the material is attached", () => {
		assert.match(newMaterialMessage(META).content, /^\[Session context\] — the learner started this session with lesson material attached: lecture\.pdf \(12 pages\)\./);
	});

	it("the header chip opens the original in a new tab", () => {
		const html = renderToStaticMarkup(<MaterialHeaderChip chatId="chat_x" name="lecture.pdf" />);
		assert.match(html, /href="\/api\/chats\/chat_x\/material"/);
		assert.match(html, /target="_blank"/);
		assert.match(html, /aria-label="Open lesson material: lecture\.pdf"/);
	});
});
