import DocumentCommentThreadRoute from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {
    loader,
    meta,
} from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id.js";

export default function DocumentCommentThreadPeekRoute() {
    return (
        <DocumentCommentThreadRoute
            withMobileLayout={usePeekContext()?.withMobileLayout ?? false}
        />
    );
}
