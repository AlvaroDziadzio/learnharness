"use client";

/**
 * The "Flashcards" settings section (design: docs/designs/flashcards.md, D9):
 * automatic cards from extraction and the daily cap on new cards.
 * Replace-whole section PUTs through the dialog's single writer, like
 * StudyTimeSection.
 */
import {
	FLASHCARDS_NEW_PER_DAY_MAX,
	FLASHCARDS_NEW_PER_DAY_MIN,
	type FlashcardSettings,
} from "@/src/core";
import { CommitInput, SettingsRow, Toggle } from "./controls.tsx";

export function FlashcardsSection({
	flashcards,
	resolved,
	onSectionChange,
}: {
	flashcards: FlashcardSettings | undefined;
	resolved: Required<FlashcardSettings>;
	onSectionChange: (next: FlashcardSettings) => void;
}) {
	return (
		<>
			<SettingsRow label="Create cards automatically" hint="From graph extraction" testid="flashcards-row-auto">
				<Toggle
					checked={flashcards?.autoCreate ?? resolved.autoCreate}
					label="create flashcards automatically"
					onChange={(on) => onSectionChange({ ...flashcards, autoCreate: on })}
				/>
			</SettingsRow>
			<SettingsRow label="New cards per day" hint={`${resolved.newPerDay}`} testid="flashcards-row-new-per-day">
				<CommitInput
					type="number"
					value={String(flashcards?.newPerDay ?? "")}
					placeholder={String(resolved.newPerDay)}
					ariaLabel="new cards per day"
					testid="input-flashcards-new-per-day"
					onCommit={(v) => {
						// Empty = factory default (absence is the unset for numbers).
						if (v === "") {
							onSectionChange({ ...flashcards, newPerDay: undefined });
							return;
						}
						const n = Number(v);
						if (!Number.isFinite(n)) return; // bad input: no write
						onSectionChange({
							...flashcards,
							newPerDay: Math.min(FLASHCARDS_NEW_PER_DAY_MAX, Math.max(FLASHCARDS_NEW_PER_DAY_MIN, Math.round(n))),
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}
