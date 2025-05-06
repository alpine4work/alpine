import {ChannelCreator} from "~/client/forum/channel_creator.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

export function meta() {
    return [{title: `New channel${metaTitlePostfix}`}];
}

export default function NewChannelRoute() {
    return (
        <ChannelCreator
            title="New channel"
            initiallyFocus={null}
            initialName=""
            initialDescription={emptyMessageContentWithReferences}
        />
    );
}
