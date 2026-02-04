import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Get the channel ID associated with a feed entry, if any. Only Post and
 * Channel entries have a channel ID. Returns null for other entry types.
 */
export function getFeedEntryChannelId(entry: FeedEntry): ChannelId | null {
    switch (entry.type) {
        case "Post":
        case "Channel":
            return entry.channelId;
        case "Welcome":
        case "Document":
        case "TaskCollection":
            return null;
        default:
            throw exhaustive(entry);
    }
}
