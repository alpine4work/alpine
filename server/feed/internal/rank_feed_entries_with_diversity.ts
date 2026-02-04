import {getFeedEntryAccountId} from "~/server/feed/internal/get_feed_entry_account_id.js";
import {getFeedEntryChannelId} from "~/server/feed/internal/get_feed_entry_channel_id.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";

/**
 * Rank feed entries by score with diversity constraints. The algorithm:
 *
 * 1. Sort entries by score descending (higher scores first)
 * 2. Greedily select entries, prioritizing diversity:
 *    - Best: different account AND different channel
 *    - Good: different account OR different channel
 *    - Fallback: highest-scored remaining entry
 *
 * This ensures that adjacent entries in the feed are unlikely to be from the
 * same author or in the same channel, while still prioritizing high-affinity
 * content.
 */
export function rankFeedEntriesWithDiversity(
    entries: ReadonlyArray<{entry: FeedEntry; score: number}>,
): Array<FeedEntry> {
    if (entries.length === 0) return [];

    // Sort by score descending. For entries with equal scores, maintain
    // original order (which should be chronological, newer first).
    const sortedEntries = [...entries].sort((a, b) => b.score - a.score);

    const result: Array<FeedEntry> = [];
    const remaining = new Set(sortedEntries.map((_, index) => index));

    while (remaining.size > 0) {
        const previousEntry = result.length > 0 ? result[result.length - 1]! : null;
        const previousAccountId = previousEntry ? getFeedEntryAccountId(previousEntry) : null;
        const previousChannelId = previousEntry ? getFeedEntryChannelId(previousEntry) : null;

        // Find the best entry to select. We prioritize diversity in the
        // following order:
        // 1. Different account AND different channel (most diverse)
        // 2. Different account OR different channel (partially diverse)
        // 3. Highest-scored remaining entry (fallback)
        let selectedIndex: number | null = null;
        let partiallyDiverseIndex: number | null = null;

        for (const index of remaining) {
            const candidate = sortedEntries[index]!.entry;
            const candidateAccountId = getFeedEntryAccountId(candidate);
            const candidateChannelId = getFeedEntryChannelId(candidate);

            // Check if account is different from previous.
            const accountDiverse =
                previousAccountId === null ||
                candidateAccountId === null ||
                previousAccountId !== candidateAccountId;

            // Check if channel is different from previous.
            const channelDiverse =
                previousChannelId === null ||
                candidateChannelId === null ||
                previousChannelId !== candidateChannelId;

            // Best case: both account and channel are diverse.
            if (accountDiverse && channelDiverse) {
                selectedIndex = index;
                break;
            }

            // Track the first partially diverse entry (different in at least
            // one dimension) as a fallback.
            if (partiallyDiverseIndex === null && (accountDiverse || channelDiverse)) {
                partiallyDiverseIndex = index;
            }
        }

        // Use partially diverse entry if no fully diverse entry found.
        if (selectedIndex === null && partiallyDiverseIndex !== null) {
            selectedIndex = partiallyDiverseIndex;
        }

        // Last resort: fall back to highest-scored remaining entry.
        if (selectedIndex === null) {
            for (const index of remaining) {
                selectedIndex = index;
                break;
            }
        }

        if (selectedIndex !== null) {
            result.push(sortedEntries[selectedIndex]!.entry);
            remaining.delete(selectedIndex);
        }
    }

    return result;
}
