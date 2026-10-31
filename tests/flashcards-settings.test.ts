/**
 * The flashcards settings section (docs/designs/flashcards.md, D9):
 * sanitizer, resolution defaults and the PUT body parser.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseFlashcardSettingsBody, SETTINGS_SECTIONS } from "../src/server/settings-body.ts";

describe("flashcards settings", () => {
	it("defaults to auto-create on and 20 new cards per day", () => {
		assert.deepEqual(resolveSettings(null).flashcards, { autoCreate: true, newPerDay: 20 });
		assert.deepEqual(resolveSettings({ version: 1, flashcards: { autoCreate: false } }).flashcards, { autoCreate: false, newPerDay: 20 });
	});

	it("the sanitizer keeps valid fields and clamps the cap", () => {
		assert.deepEqual(sanitizeUserSettings({ version: 1, flashcards: { autoCreate: "yes", newPerDay: 5000 } })?.flashcards, { newPerDay: 999 });
		assert.deepEqual(sanitizeUserSettings({ version: 1, flashcards: { newPerDay: 0.2 } })?.flashcards, { newPerDay: 1 });
	});

	it("the PUT parser is strict", () => {
		assert.ok("flashcards" in SETTINGS_SECTIONS);
		assert.deepEqual(parseFlashcardSettingsBody({ autoCreate: false, newPerDay: 30 }), { ok: true, settings: { autoCreate: false, newPerDay: 30 } });
		assert.equal(parseFlashcardSettingsBody({ newPerDay: 0 }).ok, false);
		assert.equal(parseFlashcardSettingsBody({ newPerDay: 2.5 }).ok, false);
		assert.equal(parseFlashcardSettingsBody({ autoCreate: 1 }).ok, false);
	});
});
