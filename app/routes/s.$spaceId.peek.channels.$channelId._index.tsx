import ChannelRoute from "~/app/routes/s.$spaceId.channels.$channelId._index.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {
    meta,
    loader,
    shouldRevalidate,
} from "~/app/routes/s.$spaceId.channels.$channelId._index.js";

export default function ChannelPeekRoute() {
    return <ChannelRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
