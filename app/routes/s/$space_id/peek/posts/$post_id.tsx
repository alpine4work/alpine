import PostRoute from "~/app/routes/s/$space_id/posts/$post_id.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {loader, meta} from "~/app/routes/s/$space_id/posts/$post_id.js";

export default function PostPeekRoute() {
    return <PostRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
