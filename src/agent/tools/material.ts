import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { MaterialUnit, SessionMaterial } from "../../core/contracts.ts";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { processImage } from "../image-processing/index.ts";
import { parsePageSpec } from "../subagents/pdf-ops.ts";
import { getHeadless } from "../subagents/headless.ts";
import type { ReadModel } from "./read.ts";

/**
 * The lesson-material tools (owner, 2026-11-04 — Q14): the prober's and
 * teacher's reading hands on the ONE file the session was started with.
 * No tool takes a path — each reads only this session's stored units (or,
 * for rendering, its stored original), so nothing outside the material is
 * reachable. material_render exists only when the conversation model
 * accepts images; otherwise visual reading goes through the pdf job.
 *
 * Tool contract (the web.ts law): NEVER throw into the agent loop — every
 * failure returns a clear error STRING the agent can adapt to.
 */

/** The pdf-reader's extract ceiling: narrow the spec instead of a book. */
const EXTRACT_CAP = 24_000;
/** The pdf-reader's per-call render cap. */
const RENDER_BATCH_CAP = 6;
/** Search hits shown per call. */
const SEARCH_HIT_CAP = 30;
const CONTEXT_LINES = 3;

/** What the tools read: the record's metadata, the stored units, and the
 *  stored original's path (rendering only). */
export interface MaterialToolContext {
	meta: SessionMaterial;
	readUnits: () => MaterialUnit[] | null;
	path: string | null;
}

const marker = (meta: SessionMaterial, n: number) => (meta.unit === "page" ? `--- Page ${n} ---` : `--- §${n} ---`);
const unitWord = (meta: SessionMaterial) => (meta.unit === "page" ? "page" : "section");

export function createMaterialTools(ctx: MaterialToolContext, model: ReadModel): Record<string, AgentTool<any>> {
	const extractInput = Type.Object({
		units: Type.String({
			description: `Which ${unitWord(ctx.meta)}s: 'all', '1-5', '1,3,7', or '3'. Narrow the spec for long material.`,
		}),
	});
	const searchInput = Type.Object({
		query: Type.String({ description: "Keyword or regex (case-insensitive)" }),
		literal: Type.Optional(Type.Boolean({ description: "true = treat the query literally (no regex; default false)" })),
	});
	const renderInput = Type.Object({
		pages: Type.String({ description: "Pages to look at, e.g. '3' or '2,5,8' (max 6 per call)" }),
		dpi: Type.Optional(Type.Integer({ minimum: 72, maximum: 300, description: "Render DPI (100 text / 150 default / 200 dense)" })),
	});

	const tools: Record<string, AgentTool<any>> = {
		material_extract: {
			name: "material_extract",
			label: "material_extract",
			description:
				`Read the lesson material's text by ${unitWord(ctx.meta)} (it has ${ctx.meta.count}). ` +
				"Use the outline in your instructions to pick what to read.",
			parameters: extractInput,
			execute: serverExecute("material_extract", extractInput, ({ units: spec }): string => {
				const units = ctx.readUnits();
				if (!units) return "material_extract failed: the material's text could not be read.";
				const wanted = new Set(parsePageSpec(spec, ctx.meta.count));
				if (wanted.size === 0) return `material_extract: "${spec}" matched no ${unitWord(ctx.meta)}s (1-${ctx.meta.count}).`;
				const parts = units
					.filter((u) => wanted.has(u.n))
					.map((u) => `${marker(ctx.meta, u.n)}\n\n${u.text || "[No text on this page — it is image-only; read it visually.]"}`);
				const text = parts.join("\n\n");
				return text.length > EXTRACT_CAP
					? `${text.slice(0, EXTRACT_CAP)}\n\n[Truncated at ${EXTRACT_CAP} characters — narrow the spec.]`
					: text;
			}),
		},
		material_search: {
			name: "material_search",
			label: "material_search",
			description: "Search the lesson material's text by keyword or regex (case-insensitive); returns hits with context lines.",
			parameters: searchInput,
			execute: serverExecute("material_search", searchInput, ({ query, literal }): string => {
				const units = ctx.readUnits();
				if (!units) return "material_search failed: the material's text could not be read.";
				let pattern: RegExp;
				try {
					pattern = new RegExp(literal ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query, "i");
				} catch (err) {
					return `material_search failed: invalid regex — ${(err as Error).message}. Retry with literal: true.`;
				}
				const hits: string[] = [];
				let total = 0;
				for (const u of units) {
					const lines = u.text.split("\n");
					for (let ln = 0; ln < lines.length; ln++) {
						if (!pattern.test(lines[ln]!)) continue;
						total++;
						if (hits.length >= SEARCH_HIT_CAP) continue;
						const start = Math.max(0, ln - CONTEXT_LINES);
						const end = Math.min(lines.length, ln + CONTEXT_LINES + 1);
						const context = lines.slice(start, end).map((l, j) => `${start + j === ln ? ">>>" : "   "} ${l}`).join("\n");
						const where = ctx.meta.unit === "page" ? `Page ${u.n}` : `§${u.n}`;
						hits.push(`=== ${where}, line ${ln + 1} ===\n${context}`);
					}
				}
				if (total === 0) return "No hits.";
				return hits.join("\n") + (total > hits.length ? `\n\n[${total - hits.length} more hits — narrow the query.]` : "");
			}),
		},
	};

	if (ctx.meta.unit === "page" && model.input.includes("image")) {
		tools.material_render = {
			name: "material_render",
			label: "material_render",
			description:
				"Render pages of the lesson material and look at them (equations, diagrams, image-only pages). " +
				"DPI: 100 text, 150 default, 200 dense small print. Max 6 pages per call.",
			parameters: renderInput,
			execute: serverExecute("material_render", renderInput, async ({ pages, dpi }, { signal }): Promise<string | ImageFileResult> => {
				if (!ctx.path) return "material_render failed: the material's file is missing.";
				const wanted = parsePageSpec(pages, ctx.meta.count).slice(0, RENDER_BATCH_CAP);
				if (wanted.length === 0) return `material_render: "${pages}" matched no pages (1-${ctx.meta.count}).`;
				try {
					const rendered = await getHeadless().renderPdfPages(ctx.path, wanted, { dpi: dpi ?? 150 });
					const images: { data: string; mimeType: string }[] = [];
					const notes: string[] = [];
					for (const p of rendered) {
						const image = await processImage(p.png, "image/png", { resizeOptions: model.inputLimits?.images?.resize });
						signal?.throwIfAborted();
						if (image.ok) images.push({ data: image.data, mimeType: image.mimeType });
						else notes.push(`Page ${p.page}: ${image.message}`);
					}
					if (rendered.length === 0) return "material_render failed: no pages rendered.";
					return {
						text: [`Rendered page(s) ${rendered.map((p) => p.page).join(", ")} at ${dpi ?? 150} DPI.`, ...notes].join("\n"),
						images,
					};
				} catch (err) {
					if (signal?.aborted) throw err;
					return `material_render failed: ${err instanceof Error ? err.message : String(err)}`;
				}
			}),
		};
	}
	return tools;
}
