import PostCreateRoute from "~/app/routes/s.$spaceId.posts.new.$draftId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {meta, loader} from "~/app/routes/s.$spaceId.posts.new.$draftId.js";

export default function PostCreatePeekRoute() {
    return <PostCreateRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
