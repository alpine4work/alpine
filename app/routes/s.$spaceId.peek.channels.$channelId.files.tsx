import ChannelFilesRoute from "~/app/routes/s.$spaceId.channels.$channelId.files.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {meta, loader} from "~/app/routes/s.$spaceId.channels.$channelId.files.js";

export default function ChannelFilesPeekRoute() {
    return <ChannelFilesRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
