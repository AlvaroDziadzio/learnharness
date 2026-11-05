/**
 * Lesson material routes (owner, 2026-11-04), under an isolated
 * LH_DATA_DIR (the birth-stamp discipline): the multipart create converts
 * BEFORE any record exists (refusals create nothing), stores the files,
 * stamps the record's material field, and writes the material marker
 * before the first message — after the graph-context marker when home's
 * teach-mode picks ride along. GET serves the original; deletion removes
 * the material directory with the session.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-material-route-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { POST } = await import("../app/api/chats/route.ts");
const { GET } = await import("../app/api/chats/[id]/material/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { materialStore } = await import("../src/store/materials.ts");
const { deleteChatSession } = await import("../src/server/chats.ts");
const { MATERIAL_ERRORS } = await import("../lib/material-limits.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const PDF = fs.readFileSync("tests/fixtures/sample-3page.pdf");

function create(fields: Record<string, string | File>): Promise<Response> {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return POST(new Request("http://localhost/api/chats", { method: "POST", body: form }));
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const chatCount = () => chatStore.listChats().length;

describe("POST /api/chats — multipart material create", () => {
	it("creates the session with its material field, stored files, and the marker first", async () => {
		const res = await create({ title: "", file: new File([PDF], "lecture.pdf", { type: "application/pdf" }) });
		assert.equal(res.status, 200);
		const { id, title } = await res.json() as { id: string; title: string };
		assert.equal(title, "lecture.pdf", "an empty title falls back to the filename");
		const record = chatStore.getChat(id)!;
		assert.equal(record.material?.name, "lecture.pdf");
		assert.equal(record.material?.count, 3);
		assert.equal(record.kind, undefined, "material sessions are teach sessions");
		assert.equal(record.messages.length, 1);
		assert.equal(record.messages[0]!.role, "custom");
		assert.equal((record.messages[0] as { customType: string }).customType, "material");
		assert.deepEqual(fs.readFileSync(materialStore.originalPath(id)!), PDF);
		assert.equal(materialStore.readUnits(id)?.length, 3);
	});

	it("keeps a typed title, and carries home's picks as the graph-context marker before the material", async () => {
		const picks = { propositions: [{ id: "n_a", name: "Modus ponens", statement: "If P implies Q and P holds, Q holds." }] };
		const res = await create({ title: "Physics refresher", file: new File(["# Forces\nF = ma"], "forces.md"), graphContext: JSON.stringify(picks) });
		const { id, title } = await res.json() as { id: string; title: string };
		assert.equal(title, "Physics refresher");
		const types = chatStore.getChat(id)!.messages.map((m) => (m as { customType?: string }).customType);
		assert.deepEqual(types, ["graph-context", "material"]);
	});

	it("refuses unreadable, unsupported, empty, and practice creates without creating a record", async () => {
		const before = chatCount();
		const cases: [Record<string, string | File>, number, string][] = [
			[{ file: new File(["not a pdf"], "x.pdf") }, 422, MATERIAL_ERRORS.unreadable],
			[{ file: new File(["hello"], "x.docx") }, 422, MATERIAL_ERRORS.unsupported],
			[{ file: new File(["   "], "x.txt") }, 422, MATERIAL_ERRORS.empty],
			[{ file: new File(["# A"], "x.md"), kind: "practice" }, 400, "Lesson material is for teach sessions only."],
			[{ title: "no file" }, 400, "Attach exactly one file."],
		];
		for (const [fields, status, error] of cases) {
			const res = await create(fields);
			assert.equal(res.status, status, error);
			assert.deepEqual(await res.json(), { error });
		}
		assert.equal(chatCount(), before);
		// Every material directory belongs to a live session: refusals stored nothing.
		const dirs = fs.existsSync(path.join(TMP_DATA, "materials")) ? fs.readdirSync(path.join(TMP_DATA, "materials")) : [];
		for (const dir of dirs) assert.ok(chatStore.getChat(dir), `no orphan material dir (${dir})`);
	});

	it("leaves the JSON create untouched (no material field, no marker)", async () => {
		const res = await POST(new Request("http://localhost/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "plain" }),
		}));
		const { id } = await res.json() as { id: string };
		const record = chatStore.getChat(id)!;
		assert.equal(record.material, undefined);
		assert.deepEqual(record.messages, []);
	});
});

describe("GET /api/chats/[id]/material and deletion", () => {
	it("serves the original inline, 404s without material, and dies with the session", async () => {
		const res = await create({ title: "", file: new File([PDF], "Lecture 3 – forces.pdf") });
		const { id } = await res.json() as { id: string };
		const served = await GET(new Request("http://localhost"), params(id));
		assert.equal(served.status, 200);
		assert.equal(served.headers.get("content-type"), "application/pdf");
		assert.match(served.headers.get("content-disposition") ?? "", /^inline; filename\*=UTF-8''Lecture%203%20%E2%80%93%20forces\.pdf$/);
		assert.deepEqual(Buffer.from(await served.arrayBuffer()), PDF);

		const text = await create({ title: "", file: new File(["# Notes"], "notes.md") });
		const textId = (await text.json() as { id: string }).id;
		assert.equal((await GET(new Request("http://localhost"), params(textId))).headers.get("content-type"), "text/plain; charset=utf-8");

		const plain = chatStore.createChat("no material");
		assert.equal((await GET(new Request("http://localhost"), params(plain.id))).status, 404);

		const outcome = await deleteChatSession(id, "preserve-graph");
		assert.equal(outcome.ok, true);
		assert.equal(fs.existsSync(path.join(TMP_DATA, "materials", id)), false);
		assert.equal((await GET(new Request("http://localhost"), params(id))).status, 404);
	});
});
