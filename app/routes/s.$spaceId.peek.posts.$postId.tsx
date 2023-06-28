import PostRoute from "~/app/routes/s.$spaceId.posts.$postId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {loader, meta} from "~/app/routes/s.$spaceId.posts.$postId.js";

export default function PostPeekRoute() {
    return <PostRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
