import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the account ID associated with a feed entry. For posts this is the author,
 * for shared documents/channels/task collections this is the sharer. Returns null
 * for Welcome entries since they don't have an associated account.
 */
export function getFeedEntryAccountId(entry: FeedEntry): AccountId | null {
    switch (entry.type) {
        case "Welcome":
            return null;
        case "Post":
            return entry.authorId;
        case "Document":
        case "TaskCollection":
        case "Channel":
        case "RoomChat":
            return entry.sharerId;
        default:
            throw exhaustive(entry);
    }
}
