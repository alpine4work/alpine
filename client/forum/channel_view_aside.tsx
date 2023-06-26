import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {postListViewMarginY} from "~/client/forum/post_list_view.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function ChannelViewAside({channel}: {channel: ChannelModel}) {
    return (
        <Box paddingY={postListViewMarginY}>
            <h3
                className={sprinkles({
                    paddingLeft: "2",
                    paddingBottom: "1",
                    color: "grey-50",
                })}
            >
                About
            </h3>
            <ContentView content={channel.description} />
        </Box>
    );
}
