import {FeedFileEntityEntryView} from "~/client/forum/internal/feed_file_entity_entry_view.js";
import {FeedWelcomeEntryView} from "~/client/forum/internal/feed_welcome_entry_view.js";
import {FeedEntryModel, FeedPostEntryModel} from "~/shared/feed/feed_entry_model.js";

export function FeedEntryView({
    entry,
    availableWidth,
}: {
    entry: Exclude<FeedEntryModel, FeedPostEntryModel>;
    availableWidth?: number;
}) {
    if (entry.type === "Welcome") {
        return <FeedWelcomeEntryView entry={entry} />;
    }

    return <FeedFileEntityEntryView entry={entry} availableWidth={availableWidth} />;
}
