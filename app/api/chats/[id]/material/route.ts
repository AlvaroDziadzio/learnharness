import * as fs from "node:fs";
import { getChat, stores } from "@/src/server";

/**
 * GET /api/chats/[id]/material — the session header chip's target (owner,
 * 2026-11-04 — Q19): the learner's original file, inline, for a new tab.
 * PDFs open in the browser's own viewer; Markdown and text serve as plain
 * text so they display rather than download. 404 when the session has no
 * material (or its file is gone).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	const file = chat?.material ? stores.materialStore.originalPath(id) : null;
	if (!chat?.material || !file) return Response.json({ error: "Not found" }, { status: 404 });
	let body: Buffer;
	try {
		body = fs.readFileSync(file);
	} catch {
		return Response.json({ error: "Not found" }, { status: 404 });
	}
	const type = chat.material.mediaType === "pdf" ? "application/pdf" : "text/plain; charset=utf-8";
	return new Response(new Uint8Array(body), {
		headers: {
			"Content-Type": type,
			"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(chat.material.name)}`,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
