import DocumentCommentThreadRoute from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id";

export {
    loader,
    meta,
} from "~/app/routes/s/$space_id/documents/$document_id/comments/$comment_thread_id";

export default function DocumentCommentThreadPeekRoute() {
    return <DocumentCommentThreadRoute isPeek={true} />;
}
