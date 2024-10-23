import ChannelPostsRoute from "~/app/routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {
    loader,
    meta,
} from "~/app/routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.js";

export default function ChannelPostsPeekRoute() {
    return <ChannelPostsRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
