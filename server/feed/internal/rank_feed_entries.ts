import {compareDesc} from "date-fns";
import {getFeedEntryAccountId} from "~/server/feed/internal/get_feed_entry_account_id.js";
import {getFeedEntryChannelId} from "~/server/feed/internal/get_feed_entry_channel_id.js";
import {rankFeedEntriesWithDiversity} from "~/server/feed/internal/rank_feed_entries_with_diversity.js";
import {searchAffinityEntityVeryLowIntentUpdateInteractionPoints} from "~/server/spaces/search_affinity_entity_interaction_points.js";
import {FeedEntry, getFeedEntryTime} from "~/shared/feed/feed_entry_schema.js";
import {AccountId, ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Rank feed entries using affinity scores and diversity constraints.
 *
 * The ranking algorithm:
 * 1. Sort entries chronologically (newest first) as a stable foundation
 * 2. Score each entry based on account and channel affinity
 * 3. Apply diversity constraints to avoid consecutive same-author/channel entries
 *
 * Scoring uses `max(accountAffinity, channelAffinity)` rather than adding them.
 * This ensures a high-affinity account posting in a new channel isn't outscored
 * by a low-affinity account posting in a high-affinity channel.
 */
export function rankFeedEntries({
    entries,
    searchAffinityPointsByAccountId,
    searchAffinityPointsByChannelId,
}: {
    entries: Array<FeedEntry>;
    searchAffinityPointsByAccountId: ReadonlyMap<AccountId, number>;
    searchAffinityPointsByChannelId: ReadonlyMap<ChannelId, number>;
}): Array<FeedEntry> {
    if (entries.length === 0) return [];

    // Sort entries chronologically first (newest first). This establishes a
    // stable ordering that we use as a tiebreaker for entries with equal
    // affinity scores.
    const chronologicallySortedEntries = [...entries].sort((entry1, entry2) =>
        compareDesc(getFeedEntryTime(entry1), getFeedEntryTime(entry2)),
    );

    // Score each entry based on affinity. Higher scores indicate content from
    // accounts/channels the user has interacted with more frequently.
    const scoredEntries = chronologicallySortedEntries.map((entry, chronologicalIndex) => {
        const score = computeFeedEntryScore({
            entry,
            entryCount: chronologicallySortedEntries.length,
            chronologicalIndex,
            searchAffinityPointsByAccountId,
            searchAffinityPointsByChannelId,
        });
        return {entry, score};
    });

    // Apply diversity-aware ranking to avoid consecutive entries from the same
    // author or channel while still prioritizing high-affinity content.
    return rankFeedEntriesWithDiversity(scoredEntries);
}

/**
 * Compute the ranking score for a feed entry based on affinity data.
 *
 * Uses `max(accountAffinity, channelAffinity)` to prioritize the strongest
 * signal. This prevents situations where a low-affinity account in a
 * high-affinity channel outscores a high-affinity account in a new channel.
 */
function computeFeedEntryScore({
    entry,
    entryCount,
    chronologicalIndex,
    searchAffinityPointsByAccountId,
    searchAffinityPointsByChannelId,
}: {
    entry: FeedEntry;
    entryCount: number;
    chronologicalIndex: number;
    searchAffinityPointsByAccountId: ReadonlyMap<AccountId, number>;
    searchAffinityPointsByChannelId: ReadonlyMap<ChannelId, number>;
}): number {
    const accountId = getFeedEntryAccountId(entry);
    const channelId = getFeedEntryChannelId(entry);

    const accountAffinity = accountId ? (searchAffinityPointsByAccountId.get(accountId) ?? 0) : 0;
    const channelAffinity = channelId ? (searchAffinityPointsByChannelId.get(channelId) ?? 0) : 0;

    // The chronological tiebreaker will be changed less than half a very low
    // intent update interaction for the last entry chronologically. This means the
    // chronological tiebreaker doesn't really interfere with affinity scoring.
    const chronologicalTiebreaker =
        entryCount > 1
            ? searchAffinityEntityVeryLowIntentUpdateInteractionPoints / 2 / (entryCount - 1)
            : 0;

    // Use the maximum of account and channel affinity as the primary score.
    // Subtract a small tiebreaker based on chronological position to maintain
    // time-based ordering for entries with equal affinity scores.
    return (
        Math.max(accountAffinity, channelAffinity) - chronologicalIndex * chronologicalTiebreaker
    );
}
