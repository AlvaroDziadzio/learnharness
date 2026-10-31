/**
 * Flashcard UI static renders (docs/designs/flashcards.md): the review
 * session's front/back states, the study overlay's review row, and the
 * transcript card before its store lookup lands.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newFsrsCard, previewIntervals, type FlashcardQueue, type FlashcardRecord, type StudySummary } from "../src/core";
import { ReviewSession } from "../components/review.tsx";
import { FlashcardCard } from "../components/artifacts/flashcard-card.tsx";
import { ServerEventsProvider } from "../components/server-events.tsx";
import { StudyTimeBody } from "../components/study-time-overlay.tsx";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const card: FlashcardRecord = {
	id: "fc_1",
	front: "What is $F$?",
	back: "Force",
	origin: { kind: "tool", chatId: "c1", toolCallId: "t1" },
	createdAt: NOW.toISOString(),
	updatedAt: NOW.toISOString(),
	fsrs: newFsrsCard(NOW),
};
const queue = (cards: FlashcardRecord[], canUndo = false): FlashcardQueue => ({
	cards: cards.map((c) => ({ card: c, previews: previewIntervals(c.fsrs, NOW) })),
	count: cards.length,
	canUndo,
});
const noop = () => {};

describe("ReviewSession", () => {
	it("shows the front and a reveal button, never the back, before reveal", () => {
		const html = renderToStaticMarkup(<ReviewSession queue={queue([card])} onChanged={noop} />);
		assert.match(html, /data-testid="review-card"/);
		assert.match(html, /Show answer/);
		assert.doesNotMatch(html, /review-back/);
		assert.match(html, /1 to review/);
	});

	it("says so when nothing is due", () => {
		const html = renderToStaticMarkup(<ReviewSession queue={queue([])} onChanged={noop} />);
		assert.match(html, /Nothing to review right now/);
	});
});

describe("FlashcardCard", () => {
	const connect = () => ({ addEventListener: noop, close: noop, onopen: null, onerror: null }) as never;

	it("renders the call's own cards until the store lookup lands", () => {
		const html = renderToStaticMarkup(
			<ServerEventsProvider connect={connect}>
				<FlashcardCard
					part={{
						type: "tool-flashcard",
						state: "output-available",
						toolCallId: "t1",
						input: { cards: [{ front: "Q one", back: "A one" }] },
						output: { cardIds: ["fc_1"] },
					}}
				/>
			</ServerEventsProvider>,
		);
		assert.match(html, /1 flashcard added/);
		assert.match(html, /Q one/);
	});

	it("renders nothing for an errored call", () => {
		const html = renderToStaticMarkup(
			<ServerEventsProvider connect={connect}>
				<FlashcardCard part={{ type: "tool-flashcard", state: "output-error", toolCallId: "t1", input: {} }} />
			</ServerEventsProvider>,
		);
		assert.equal(html, "");
	});
});

describe("study overlay", () => {
	it("labels the review entry Flashcard review", () => {
		const summary: StudySummary = {
			cards: { todayMs: 600_000, weekMs: 600_000, totalMs: 600_000 },
			range: { key: "week", perChat: [{ source: "review", ms: 600_000 }], hours: new Array(24).fill(0) },
			grid: { weekStart: "monday", days: [] },
			idleMinutes: 5,
		};
		const html = renderToStaticMarkup(
			<StudyTimeBody summary={summary} titles={new Map()} range="week" onRange={noop} state="ready" />,
		);
		assert.match(html, /Flashcard review/);
	});
});
