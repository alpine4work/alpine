import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

export const channelViewAsidePaddingY = "4";

export function ChannelViewAside({channel}: {channel: ChannelModel}) {
    return (
        <Box paddingY={channelViewAsidePaddingY}>
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
