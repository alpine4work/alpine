import DocumentNewCommentThreadsRoute from "~/app/routes/s/$space_id/notifications/document-comment-threads/$document_id_and_bucket_generation";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {
    loader,
    meta,
} from "~/app/routes/s/$space_id/notifications/document-comment-threads/$document_id_and_bucket_generation";

export default function DocumentNewCommentThreadsPeekRoute() {
    return (
        <DocumentNewCommentThreadsRoute
            withMobileLayout={usePeekContext()?.withMobileLayout ?? false}
        />
    );
}
