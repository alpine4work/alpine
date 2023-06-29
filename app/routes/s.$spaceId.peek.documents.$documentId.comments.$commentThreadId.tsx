import DocumentCommentThreadRoute from "~/app/routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";

export {
    loader,
    meta,
} from "~/app/routes/s.$spaceId.documents.$documentId.comments.$commentThreadId.js";

export default function DocumentCommentThreadPeekRoute() {
    return (
        <DocumentCommentThreadRoute
            withMobileLayout={usePeekContext()?.withMobileLayout ?? false}
        />
    );
}
