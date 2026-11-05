/**
 * Lesson material persistence (owner, 2026-11-04): one directory per
 * session, data/materials/<chatId>/, holding the learner's original file
 * (original.<ext>, served back by GET /api/chats/[id]/material) and the
 * converted units the material tools read (units.json). The record's
 * material field carries the metadata; this store only owns the files.
 * Synchronous node:fs like the other stores; id-guarded like chats.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { MaterialUnit } from "../core/contracts.ts";
import type { MaterialStore } from "../core/ports.ts";

const UNITS_FILE = "units.json";

function materialDir(chatId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(chatId)) throw new Error(`Invalid chat id: ${chatId}`);
	return path.join(PATHS.materials, chatId);
}

function save(chatId: string, original: Uint8Array, extension: string, units: MaterialUnit[]): void {
	if (!/^[a-z]+$/.test(extension)) throw new Error(`Invalid material extension: ${extension}`);
	const dir = materialDir(chatId);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `original.${extension}`), original);
	fs.writeFileSync(path.join(dir, UNITS_FILE), JSON.stringify(units), "utf-8");
}

function originalPath(chatId: string): string | null {
	const dir = materialDir(chatId);
	try {
		const file = fs.readdirSync(dir).find((f) => f.startsWith("original."));
		return file ? path.join(dir, file) : null;
	} catch {
		return null;
	}
}

function readUnits(chatId: string): MaterialUnit[] | null {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(path.join(materialDir(chatId), UNITS_FILE), "utf-8"));
		if (!Array.isArray(parsed)) return null;
		return parsed.filter(
			(u): u is MaterialUnit => typeof u === "object" && u !== null && typeof u.n === "number" && typeof u.text === "string",
		);
	} catch {
		return null;
	}
}

function remove(chatId: string): void {
	fs.rmSync(materialDir(chatId), { recursive: true, force: true });
}

export const materialStore: MaterialStore = { save, originalPath, readUnits, delete: remove };
