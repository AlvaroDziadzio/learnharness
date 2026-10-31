"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LayersIcon } from "lucide-react";
import { fetchFlashcardQueue } from "@/components/flashcards-client";
import { useServerEvent, useServerResync } from "@/components/server-events";

/**
 * The sidebar's Review row (design: docs/designs/flashcards.md): opens
 * /review, badged with the queue count (due now + new still allowed today).
 * Refetched on `flashcards-changed`, reconnect, and once a minute so cards
 * coming due show without an event.
 */
export function ReviewLink() {
	const router = useRouter();
	const pathname = usePathname();
	const [count, setCount] = useState(0);
	const load = useCallback(() => {
		fetchFlashcardQueue().then(
			(q) => setCount(q.count),
			() => {},
		);
	}, []);
	useEffect(() => {
		load();
		const timer = window.setInterval(load, 60_000);
		return () => window.clearInterval(timer);
	}, [load]);
	useServerEvent("flashcards-changed", load);
	useServerResync(load);

	return (
		<button
			type="button"
			data-testid="sidebar-review"
			onClick={() => router.push("/review")}
			className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider transition-colors hover:bg-accent hover:text-foreground ${
				pathname === "/review" ? "bg-accent text-foreground" : "text-muted-foreground"
			}`}
		>
			<LayersIcon className="size-3" />
			Review
			{count > 0 && (
				<span data-testid="sidebar-review-count" className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">
					{count}
				</span>
			)}
			<span className="sr-only">review flashcards</span>
		</button>
	);
}
