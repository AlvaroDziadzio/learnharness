import { clearOpeningPrompt, OPENING_PROMPT_FAILURE, stashOpeningPrompt } from "./opening-prompt";

interface SessionCreation {
	title: string;
	kind?: "practice";
	graphContext?: { propositions: readonly { id: string; name: string; statement: string }[] };
	/** The first message to send, when it differs from the title (a
	 *  material-only start: the title is the filename server-side, the
	 *  opening is the fixed material text). Defaults to the title. */
	opening?: string;
}

/** The server refused the lesson material (unsupported, too big, unreadable,
 *  too long, scanned, empty): the message shows under the draft chip and the
 *  draft stays. No session was created. */
export class MaterialRefusedError extends Error {}

/** Per source-composer instance. Retain a successful creation if storage
 * fails, so an unchanged retry does not create another empty session.
 * Changed text/context/settings/material is a different start, not a stale title.
 */
export class SessionStarter {
	private created?: { identity: string; id: string };

	async start(body: SessionCreation, fetchLike: typeof fetch, settingsIdentity?: string, material?: File): Promise<string> {
		const identity = JSON.stringify([body, settingsIdentity, material ? [material.name, material.size, material.lastModified] : null]);
		if (this.created?.identity !== identity) {
			if (this.created) clearOpeningPrompt(this.created.id);
			this.created = undefined;
			const res = await fetchLike("/api/chats", material ? { method: "POST", body: materialForm(body, material) } : {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				if (material && res.status >= 400 && res.status < 500) {
					const refusal = await res.json().catch(() => null) as { error?: unknown } | null;
					if (typeof refusal?.error === "string") throw new MaterialRefusedError(refusal.error);
				}
				throw new Error(OPENING_PROMPT_FAILURE);
			}
			const result = await res.json() as { id?: unknown };
			if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(result.id)) throw new Error(OPENING_PROMPT_FAILURE);
			this.created = { identity, id: result.id };
		}
		if (!stashOpeningPrompt(this.created.id, body.opening ?? body.title)) throw new Error(OPENING_PROMPT_FAILURE);
		return `/chat/${this.created.id}`;
	}
}

/** The material create's multipart body (teach only — no kind). Home's
 *  teach-mode picks ride along as a JSON field. */
function materialForm(body: SessionCreation, material: File): FormData {
	const form = new FormData();
	form.set("title", body.title);
	form.set("file", material);
	if (body.graphContext) form.set("graphContext", JSON.stringify(body.graphContext));
	return form;
}
