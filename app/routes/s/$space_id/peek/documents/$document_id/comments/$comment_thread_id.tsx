import DocumentCommentThreadRoute from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id";
import {usePeekContext} from "~/client/peek/peek_remix_embed";

export {
    loader,
    meta,
} from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id";

export default function DocumentCommentThreadPeekRoute() {
    return (
        <DocumentCommentThreadRoute
            withMobileLayout={usePeekContext()?.withMobileLayout ?? false}
        />
    );
}
