import ChannelPostsRoute from "~/app/routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.js";

export {
    loader,
    meta,
} from "~/app/routes/s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.js";

export default function ChannelPostsPeekRoute() {
    return (
        <ChannelPostsRoute
            // We intentionally don't use the mobile layout for the document comment
            // threads peek. Having no X margin by having Y margin looks a little weird in
            // a peek rendered on top of other content.
            withMobileLayout={false}
        />
    );
}
