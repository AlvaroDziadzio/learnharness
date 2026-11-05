/**
 * Lesson material in the agents (owner, 2026-11-04): the material-only
 * fragments and the outline appendix compose ONLY with material (ordinary
 * sessions keep their exact prompt), the outline caps itself, and the
 * material tools read only the session's own units — material_render
 * existing only for image-capable models. Closed network, isolated data.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import type { AgentMaterial } from "../src/agent/teacher-agent.ts";
import type { MaterialUnit, SessionMaterial } from "../src/core/contracts.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-material-agents-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
	HOME: path.join(scratch, "home"),
};
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { composeInstructions, createProberAgent, createTeacherAgent, createPracticeAgent } = await import("../src/agent/teacher-agent.ts");
const { materialOutlinePrompt } = await import("../src/agent/material-prompt.ts");
const { createMaterialTools } = await import("../src/agent/tools/material.ts");
const { MATERIAL_OUTLINE_CHARS } = await import("../lib/material-limits.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");

const META: SessionMaterial = {
	name: "lecture.pdf",
	mediaType: "pdf",
	bytes: 1234,
	unit: "page",
	count: 3,
	imageOnly: [3],
	outline: [
		{ title: "Forces", level: 1, at: 1 },
		{ title: "Newton's second law", level: 2, at: 2 },
	],
	flagged: [2],
};
const UNITS: MaterialUnit[] = [
	{ n: 1, text: "# Forces\n\nA force is a push or a pull." },
	{ n: 2, text: "## Newton's second law\n\nF = ma relates force, mass, and acceleration." },
	{ n: 3, text: "" },
];
const material = (meta = META, units: MaterialUnit[] | null = UNITS): AgentMaterial => ({ meta, path: "/data/materials/c/original.pdf", readUnits: () => units });

function engineFor(vision: boolean, steps: FauxResponseStep[] = []) {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	const base = faux.getModel();
	const engine: PiEngine = { model: { ...base, input: vision ? ["text", "image"] : ["text"] }, streamFn: faux.streamSimple };
	return engine;
}
const chatId = chatStore.createChat("material agents").id;
const prober = (opts: Parameters<typeof createProberAgent>[1]) => createProberAgent({ chatId, chatStore, jobStore, deliver: () => {}, spawn: () => {} }, opts);
const teacher = (opts: Parameters<typeof createTeacherAgent>[1]) => createTeacherAgent({ chatId, chatStore, jobStore, spawn: () => {} }, opts);
const toolNames = (agent: { state: { tools: { name: string }[] } }) => agent.state.tools.map((t) => t.name);

async function run(tool: { execute: (id: string, input: unknown) => Promise<{ content: { type: string; text?: string }[] }> }, input: unknown): Promise<string> {
	const result = await tool.execute("t1", input);
	return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

describe("prompt composition", () => {
	it("composes the material fragments and the outline only with material", () => {
		for (const kind of ["prober", "teacher"] as const) {
			const plain = composeInstructions(kind);
			const withMaterial = composeInstructions(kind, undefined, material());
			assert.ok(!plain.includes("# Lesson material"), `${kind}: an ordinary session never sees material doctrine`);
			assert.ok(withMaterial.startsWith(plain.split("\n\n---\n\n")[0]!), `${kind}: same base`);
			assert.ok(withMaterial.includes("This session has lesson material"), `${kind}: fragment composes`);
			assert.ok(withMaterial.trimEnd().endsWith(materialOutlinePrompt(META, "/data/materials/c/original.pdf").trimEnd()), `${kind}: outline trails`);
		}
	});

	it("puts the outline in the agents' system prompt, never for practice", () => {
		assert.ok(teacher({ engine: engineFor(false), material: material() }).state.systemPrompt.includes("- Forces — p. 1"));
		assert.ok(prober({ engine: engineFor(false), material: material() }).state.systemPrompt.includes("Stored at: /data/materials/c/original.pdf"));
		const practice = createPracticeAgent({ chatId, chatStore }, { engine: engineFor(false), material: material() });
		assert.ok(!practice.state.systemPrompt.includes("# Lesson material"));
		assert.ok(!toolNames(practice).includes("material_extract"));
	});

	it("outlines pages vs sections, flags visual pages, and caps long outlines", () => {
		const pdf = materialOutlinePrompt(META, "/x/original.pdf");
		assert.match(pdf, /The learner attached: lecture\.pdf \(PDF, 3 pages\)\./);
		assert.match(pdf, /  - Newton's second law — p\. 2/);
		assert.match(pdf, /Math\/image-heavy pages: 2/);
		assert.match(pdf, /Image-only pages \(text tools see nothing; read visually\): 3/);
		const md = materialOutlinePrompt({ ...META, mediaType: "markdown", unit: "section", imageOnly: [], flagged: [] }, null);
		assert.match(md, /\(Markdown, 3 sections\)/);
		assert.match(md, /- Forces — §1/);
		assert.ok(!md.includes("Stored at"), "the pdf job path is for PDFs only");
		const long = materialOutlinePrompt({
			...META,
			outline: Array.from({ length: 2000 }, (_, i) => ({ title: `Heading number ${i}`, level: (i % 3) + 1, at: i + 1 })),
		}, null);
		assert.ok(long.length <= MATERIAL_OUTLINE_CHARS, `capped (${long.length})`);
		assert.match(long, /…\[outline truncated — use material_search\]/);
		assert.ok(!/  - Heading/.test(long), "deeper levels go first");
	});
});

describe("material tools", () => {
	it("register for prober and teacher; material_render only for image-capable models and PDFs", () => {
		assert.deepEqual(toolNames(teacher({ engine: engineFor(false), material: material() })).filter((n) => n.startsWith("material_")), ["material_extract", "material_search"]);
		assert.deepEqual(toolNames(prober({ engine: engineFor(true), material: material() })).filter((n) => n.startsWith("material_")), ["material_extract", "material_search", "material_render"]);
		const md = { ...META, mediaType: "markdown" as const, unit: "section" as const };
		assert.ok(!("material_render" in createMaterialTools(material(md), { input: ["text", "image"] })));
		assert.ok(!toolNames(teacher({ engine: engineFor(true) })).some((n) => n.startsWith("material_")), "no material, no tools");
	});

	it("extract reads only the stored units, marks image-only pages, and caps output", async () => {
		const tools = createMaterialTools(material(), { input: ["text"] });
		assert.equal(await run(tools.material_extract as never, { units: "2" }), "--- Page 2 ---\n\n## Newton's second law\n\nF = ma relates force, mass, and acceleration.");
		assert.match(await run(tools.material_extract as never, { units: "3" }), /image-only; read it visually/);
		assert.match(await run(tools.material_extract as never, { units: "9" }), /matched no pages \(1-3\)/);
		const big = createMaterialTools(material({ ...META, count: 1 }, [{ n: 1, text: "x".repeat(30_000) }]), { input: ["text"] });
		assert.match(await run(big.material_extract as never, { units: "all" }), /\[Truncated at 24000 characters — narrow the spec\.\]$/);
		const missing = createMaterialTools(material(META, null), { input: ["text"] });
		assert.match(await run(missing.material_extract as never, { units: "1" }), /could not be read/);
	});

	it("search finds hits with context, section labels for text, and adapts to bad regexes", async () => {
		const tools = createMaterialTools(material(), { input: ["text"] });
		assert.match(await run(tools.material_search as never, { query: "F = ma" }), /=== Page 2, line 3 ===\n.*\n.*\n>>> F = ma/);
		assert.equal(await run(tools.material_search as never, { query: "entropy" }), "No hits.");
		assert.match(await run(tools.material_search as never, { query: "(" }), /invalid regex .* Retry with literal: true\./);
		assert.match(await run(tools.material_search as never, { query: "(", literal: true }), /No hits\./);
		const md = createMaterialTools(material({ ...META, unit: "section", mediaType: "markdown" }), { input: ["text"] });
		assert.match(await run(md.material_search as never, { query: "push" }), /=== §1, line 3 ===/);
	});

	it("render refuses cleanly when the stored file is gone", async () => {
		const tools = createMaterialTools({ ...material(), path: null }, { input: ["text", "image"] });
		assert.match(await run(tools.material_render as never, { pages: "1" }), /file is missing/);
	});

	it("the teacher loop calls a material tool end to end", async () => {
		const engine = engineFor(false, [
			fauxAssistantMessage([fauxToolCall("material_extract", { units: "1" }, { id: "m1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("Read page 1.")]),
		]);
		const agent = teacher({ engine, material: material() });
		await agent.prompt("Read the first page.");
		const result = agent.state.messages.find((m) => m.role === "toolResult" && m.toolCallId === "m1");
		assert.ok(result && result.role === "toolResult" && !result.isError);
		assert.match(JSON.stringify(result.content), /A force is a push or a pull/);
	});
});
