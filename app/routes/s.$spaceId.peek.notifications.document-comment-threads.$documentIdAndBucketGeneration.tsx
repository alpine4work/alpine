import DocumentNewCommentThreadsRoute from "~/app/routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.js";

export {
    loader,
    meta,
} from "~/app/routes/s.$spaceId.notifications.document-comment-threads.$documentIdAndBucketGeneration.js";

export default function DocumentNewCommentThreadsPeekRoute() {
    return (
        <DocumentNewCommentThreadsRoute
            // We intentionally don't use the mobile layout for the document comment
            // threads peek. Having no X margin by having Y margin looks a little weird in
            // a peek rendered on top of other content.
            withMobileLayout={false}
        />
    );
}
