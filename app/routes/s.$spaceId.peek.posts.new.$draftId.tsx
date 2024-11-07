import PostCreateRoute from "~/app/routes/s.$spaceId.posts.new.$draftId.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {meta, loader, shouldRevalidate} from "~/app/routes/s.$spaceId.posts.new.$draftId.js";

export default function PostCreatePeekRoute() {
    return <PostCreateRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
