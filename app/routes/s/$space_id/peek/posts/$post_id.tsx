import PostRoute from "~/app/routes/s/$space_id/posts/$post_id";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {loader, meta} from "~/app/routes/s/$space_id/posts/$post_id";

export default function PostPeekRoute() {
    return <PostRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
