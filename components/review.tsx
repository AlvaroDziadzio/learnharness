"use client";

import { useCallback, useEffect, useState } from "react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { FlashcardBrowse } from "@/components/flashcard-browse";
import { fetchFlashcardQueue, sendFlashcardReview } from "@/components/flashcards-client";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { useStudyTracker } from "@/components/use-study-tracker";
import { REVIEW_TIMER_KEY, type FlashcardQueue, type FsrsGrade } from "@/src/core";

const GRADES: { grade: FsrsGrade; label: string }[] = [
	{ grade: 1, label: "Again" },
	{ grade: 2, label: "Hard" },
	{ grade: 3, label: "Good" },
	{ grade: 4, label: "Easy" },
];

/** Typing in a field never rates or undoes. */
function isEditable(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * One review session over the queue (design: docs/designs/flashcards.md):
 * front → reveal (Space/Enter) → rate (1–4). Ctrl/Cmd+Z undoes the last
 * rating once. Purely local: no model calls.
 */
export function ReviewSession({ queue, onChanged }: { queue: FlashcardQueue; onChanged: () => void }) {
	const current = queue.cards[0] ?? null;
	const [revealed, setRevealed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// A new front card starts hidden.
	const currentId = current?.card.id;
	useEffect(() => setRevealed(false), [currentId]);

	const act = useCallback(
		async (input: Parameters<typeof sendFlashcardReview>[0]) => {
			setBusy(true);
			setError(null);
			try {
				await sendFlashcardReview(input);
				onChanged();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setBusy(false);
			}
		},
		[onChanged],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (busy || isEditable(e.target)) return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				if (!queue.canUndo) return;
				e.preventDefault();
				void act({ type: "undo" });
				return;
			}
			if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
			if (!revealed && (e.key === " " || e.key === "Enter")) {
				e.preventDefault();
				setRevealed(true);
				return;
			}
			const grade = Number(e.key);
			if (revealed && grade >= 1 && grade <= 4) {
				e.preventDefault();
				void act({ type: "rate", cardId: current.card.id, grade: grade as FsrsGrade });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [act, busy, current, queue.canUndo, revealed]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span data-testid="review-remaining">{queue.count} to review</span>
				<Button size="xs" variant="ghost" disabled={busy || !queue.canUndo} onClick={() => void act({ type: "undo" })}>
					Undo
				</Button>
			</div>
			{current ? (
				<div data-testid="review-card" className="rounded-xl border bg-card/60 p-6">
					<div className="text-lg">
						<ToolContentResponse>{current.card.front}</ToolContentResponse>
					</div>
					{revealed ? (
						<>
							<hr className="my-4 border-border" />
							<div data-testid="review-back">
								<ToolContentResponse>{current.card.back}</ToolContentResponse>
							</div>
							<div className="mt-6 grid grid-cols-4 gap-2">
								{GRADES.map(({ grade, label }) => (
									<Button
										key={grade}
										variant={grade === 3 ? "default" : "outline"}
										disabled={busy}
										onClick={() => void act({ type: "rate", cardId: current.card.id, grade })}
									>
										{label} · {current.previews[grade]}
										<kbd className="ml-1 text-xs opacity-60">{grade}</kbd>
									</Button>
								))}
							</div>
						</>
					) : (
						<Button className="mt-6 w-full" variant="outline" onClick={() => setRevealed(true)}>
							Show answer <kbd className="ml-1 text-xs opacity-60">Space</kbd>
						</Button>
					)}
				</div>
			) : (
				<p data-testid="review-empty" className="py-12 text-center text-sm text-muted-foreground">
					Nothing to review right now.
				</p>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	);
}

/** The /review page: Review and Cards tabs under the standard top bar. */
export function ReviewPage() {
	const [tab, setTab] = useState<"review" | "cards">("review");
	const [queue, setQueue] = useState<FlashcardQueue | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		fetchFlashcardQueue().then(
			(next) => {
				setQueue(next);
				setError(null);
			},
			(err: unknown) => setError(err instanceof Error ? err.message : String(err)),
		);
	}, []);
	useEffect(load, [load]);
	useServerEvent("flashcards-changed", load);
	useServerResync(load);
	useStudyTracker(REVIEW_TIMER_KEY, true);
	// A learning step (Again → 1m) comes due without any event: refetch then.
	// Only within a day; longer waits are picked up by any later refetch.
	const nextDueAt = queue?.nextDueAt;
	useEffect(() => {
		if (!nextDueAt) return;
		const wait = Date.parse(nextDueAt) - Date.now();
		if (wait > 86_400_000) return;
		const timer = window.setTimeout(load, Math.max(0, wait) + 500);
		return () => window.clearTimeout(timer);
	}, [nextDueAt, load]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex gap-1">
					{(["review", "cards"] as const).map((t) => (
						<button
							key={t}
							type="button"
							data-testid={`review-tab-${t}`}
							onClick={() => setTab(t)}
							className={`rounded-md px-2 py-1 text-xs uppercase tracking-wider transition-colors ${
								tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
							}`}
						>
							{t === "review" ? "Review" : "Cards"}
						</button>
					))}
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-2xl px-4 py-6">
					{tab === "cards" ? (
						<FlashcardBrowse />
					) : error ? (
						<p className="text-sm text-destructive">{error}</p>
					) : queue ? (
						<ReviewSession queue={queue} onChanged={load} />
					) : (
						<p className="text-sm text-muted-foreground">Loading…</p>
					)}
				</div>
			</div>
		</div>
	);
}
