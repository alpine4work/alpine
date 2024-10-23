import DocumentRoute from "~/app/routes/s.$spaceId.documents.$documentId._index.js";
import {usePeekContext} from "~/client/peek/peek_context.js";

export {
    loader,
    meta,
    shouldRevalidate,
} from "~/app/routes/s.$spaceId.documents.$documentId._index.js";

export default function DocumentPeekRoute() {
    return <DocumentRoute withMobileLayout={usePeekContext()?.withMobileLayout ?? false} />;
}
