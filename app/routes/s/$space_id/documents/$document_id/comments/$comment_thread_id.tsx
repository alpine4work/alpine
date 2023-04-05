import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {DocumentCommentThreadListView} from "~/client/documents/document_comment_thread_list_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getDocumentCommentThreadAndInitialComments} from "~/server/dynamo/documents_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types";
import {DocumentCommentModel, DocumentCommentThreadModel} from "~/shared/models/document_model";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({
    documentId: Schema.id<DocumentId>(),
    commentThread: DocumentCommentThreadModel.schema(),
    initialComments: Schema.array(DocumentCommentModel.schema()),
    initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>().deserialize(
        params.comment_thread_id ?? null,
    );

    const commentThreadResult = await getDocumentCommentThreadAndInitialComments(
        await context.auth.authenticate(),
        {
            documentId,
            commentThreadId,
            limit: getInitialLoadMessageCount(context.loader.clientInfo),
        },
    );
    if (!commentThreadResult) throw new NotFoundError("Comment thread not found");

    return jsonWithSchema(LoaderSchema, {documentId, ...commentThreadResult});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {commentThread}}) => {
    if (commentThread.commentAuthors.length === 0) {
        return {title: `Document comment thread${metaTitlePostfix}`};
    }

    return {
        title: `Document comment thread by ${getAccountShortNameWithoutFullNameTooltip(
            commentThread.commentAuthors[0]!,
        )}${metaTitlePostfix}`,
    };
});

export default function DocumentCommentThreadRoute({isPeek}: {isPeek?: boolean}) {
    const {documentId, commentThread, initialComments, initialOtherReferencedComments} =
        useLoaderDataWithSchema(LoaderSchema);

    return (
        <DocumentCommentThreadListView
            documentId={documentId}
            initialCommentThreadsResult={{
                commentThread,
                comments: initialComments,
                otherReferencedComments: initialOtherReferencedComments,
            }}
            withMobileLayout={isPeek}
        />
    );
}
