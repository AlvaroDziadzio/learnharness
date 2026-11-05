import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { compactionInFlight, convertMaterial, createChat, isTurnRunning, listChats, readSettingsRecord, stores, titleFromPrompt } from "@/src/server";
import { newMaterialMessage } from "@/src/core";
import { BodyLimitError, readBoundedForm } from "@/lib/bounded-form.ts";
import { MATERIAL_ERRORS, MAX_MATERIAL_BODY_BYTES, MAX_MATERIAL_BYTES } from "@/lib/material-limits.ts";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	// Lesson material (owner, 2026-11-04): a multipart create carries ONE
	// file; the session exists only once it converted and stored.
	if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) return createWithMaterial(req);
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind);
	stampStrongSlot(chat.id);
	const graphContext = graphContextMessage(body.graphContext);
	if (graphContext) stores.chatStore.saveMessages(chat.id, [graphContext]);
	return Response.json({ id: chat.id, title: chat.title });
}

// The session's map context (owner, 2026-10-04): the picked
// propositions ride the CREATION — message[0] is a graph-context
// marker (a separate custom message BEFORE the learner's first user
// message), carrying the picks plus the reasoning chains among them.
// The picks carry their own name/statement (what the learner saw at
// pick time); the chains derive from the CURRENT graph snapshot.
function graphContextMessage(graphContext: unknown): ReturnType<typeof newGraphContextMessage> | null {
	const rawPicks = (graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length === 0) return null;
	const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
	const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
	const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
		formatChainLine(c, Object.fromEntries(byId)),
	);
	return newGraphContextMessage(picks, chainLines);
}

// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
// thinking level from birth — stamped verbatim from the STRONG slot,
// the new-session default. From here the strong slot never reaches
// this session again: in-session picks write the session's own record
// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
// boot) → no stamp; the turn gate's 503 models_not_configured envelope
// refuses honestly until the setup flow fills the slot.
function stampStrongSlot(chatId: string): void {
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chatId, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
}

/**
 * The material create (owner, 2026-11-04 — Q23: upload rides the create).
 * Fields: "title" (may be empty — the filename stands in) and "file". The
 * file converts BEFORE any record exists: a refusal (type, size, unreadable,
 * too long, fully scanned, empty) answers 4xx {error} and creates nothing.
 * Teach sessions only (Q13). On success: record with its material field,
 * the strong-slot stamp, the stored files, and the material marker before
 * the first message (the graph-context precedent). An optional
 * "graphContext" field (JSON) carries home's teach-mode picks.
 */
async function createWithMaterial(req: Request): Promise<Response> {
	let form: FormData;
	try {
		form = await readBoundedForm(req, MAX_MATERIAL_BODY_BYTES);
	} catch (err) {
		return err instanceof BodyLimitError
			? Response.json({ error: MATERIAL_ERRORS.tooBig }, { status: 413 })
			: Response.json({ error: "Could not read the upload. It may be incomplete; please attach the file again." }, { status: 400 });
	}
	if (form.get("kind") === "practice") {
		return Response.json({ error: "Lesson material is for teach sessions only." }, { status: 400 });
	}
	const files = form.getAll("file").filter((f): f is File => f instanceof File);
	if (files.length !== 1) return Response.json({ error: "Attach exactly one file." }, { status: 400 });
	const file = files[0]!;
	if (file.size > MAX_MATERIAL_BYTES) return Response.json({ error: MATERIAL_ERRORS.tooBig }, { status: 413 });
	const bytes = new Uint8Array(await file.arrayBuffer());
	const converted = await convertMaterial(bytes, file.name);
	if (converted.kind === "refused") return Response.json({ error: converted.error }, { status: 422 });

	const rawTitle = form.get("title");
	const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle : file.name;
	const chat = createChat(titleFromPrompt(title), undefined, converted.material);
	try {
		stores.materialStore.save(chat.id, bytes, converted.extension, converted.units);
	} catch (err) {
		// No session without its material: undo the birth write.
		console.error(`[chat ${chat.id}] material store failed:`, err);
		stores.chatStore.deleteChat(chat.id);
		stores.materialStore.delete(chat.id);
		return Response.json({ error: "Could not save the material. Try again." }, { status: 500 });
	}
	stampStrongSlot(chat.id);
	// Picks + material (owner, 2026-11-04): both cards — the map context
	// first, then the material, both before the learner's first message.
	const rawContext = form.get("graphContext");
	let parsedContext: unknown = null;
	try {
		parsedContext = typeof rawContext === "string" ? JSON.parse(rawContext) : null;
	} catch {
		/* a malformed context field starts the session pickless */
	}
	const graphContext = graphContextMessage(parsedContext);
	stores.chatStore.saveMessages(chat.id, [
		...(graphContext ? [graphContext] : []),
		newMaterialMessage(converted.material, converted.notice),
	]);
	return Response.json({ id: chat.id, title: chat.title, ...(converted.notice ? { notice: converted.notice } : {}) });
}
