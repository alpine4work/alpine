import DocumentNewCommentThreadsRoute from "~/app/routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {
    loader,
    meta,
} from "~/app/routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.js";

export default function DocumentNewCommentThreadsPeekRoute() {
    return (
        <DocumentNewCommentThreadsRoute
            withMobileLayout={usePeekContext()?.withMobileLayout ?? false}
        />
    );
}
