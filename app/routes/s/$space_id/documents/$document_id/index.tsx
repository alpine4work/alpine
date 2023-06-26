import {ShouldReloadFunction, useSearchParams} from "@remix-run/react";
import {useEffect} from "react";
import {DocumentContentEditor} from "~/client/documents/document_content_editor.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {
    createDocument,
    getDocument,
    getDocumentCommentThreadAndInitialComments,
} from "~/server/dynamo/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
    commentThreadResult: Schema.object({
        commentThread: DocumentCommentThreadModel.schema(),
        initialComments: Schema.array(DocumentCommentModel.schema()),
        initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
    }).nullable(),
});

export async function loader({params, context, request}: LoaderArgs) {
    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const documentId = Schema.id<DocumentId>().deserialize(params.document_id ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>()
        .nullable()
        .deserialize(url.searchParams.get("comments"));

    const [document, commentThreadResult] = await runAllPromises([
        (async () => {
            // If the `create` query parameter is included then we will attempt to create
            // the document if it does not already exist. If the document does already
            // exist then we will load it.
            if (url.searchParams.has("create")) {
                try {
                    const content = emptyDocumentContent;

                    const newDocument = await createDocument(await context.actor.authenticate(), {
                        id: documentId,
                        spaceId,
                        content,
                    });

                    return new DocumentModel({
                        ...newDocument,
                        spaceId,
                        content: {
                            doc: content,
                            references: emptyDocumentContentReferences,
                        },
                    });
                } catch (error) {
                    if (error instanceof FailedPreconditionError) {
                        // The document already exists! Try reading it...
                    } else {
                        throw error;
                    }
                }
            }

            return getDocument(await context.actor.authenticate(), documentId);
        })(),
        commentThreadId
            ? getDocumentCommentThreadAndInitialComments(await context.actor.authenticate(), {
                  documentId,
                  commentThreadId,
                  limit: getInitialLoadMessageCount(context.loader.clientInfo),
              })
            : null,
    ]);

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document, commentThreadResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => ({
    title: document.getTitle(),
}));

// We don't need to reload when certain search params change.
export const unstable_shouldReload: ShouldReloadFunction = ({url: _url, prevUrl: _prevUrl}) => {
    const url = new URL(_url);
    const prevUrl = new URL(_prevUrl);

    url.searchParams.delete("create");
    prevUrl.searchParams.delete("create");

    url.searchParams.delete("comments");
    prevUrl.searchParams.delete("comments");

    return url.toString() !== prevUrl.toString();
};

export default function DocumentRoute() {
    const {document, commentThreadResult} = useLoaderDataWithSchema(LoaderSchema);
    const [searchParams, setSearchParams] = useSearchParams();
    const updateMetaTitle = useUpdateMetaTitle();

    // Remove the `create` search param.
    useEffect(() => {
        if (searchParams.has("create")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            setSearchParams(newSearchParams);
        }
    }, [searchParams, setSearchParams]);

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    return (
        <DocumentContentEditor
            // Re-render when the document changes
            key={document.id}
            initialDocument={document}
            initialCommentThreadResult={commentThreadResult}
            initialScrollToCommentIndex={commentIndex}
            onContentChange={content => {
                updateMetaTitle(`${getDocumentContentTitle(content)}${metaTitlePostfix}`);
            }}
            onCommentThreadChange={commentThreadId => {
                const url = new URL(window.location.href);
                if (commentThreadId) {
                    url.searchParams.set("comments", commentThreadId);
                    url.searchParams.delete("comment");
                } else {
                    url.searchParams.delete("comments");
                    url.searchParams.delete("comment");
                }

                // Silently update the URL without telling Remix so our component doesn't
                // re-render unnecessarily.
                window.history.replaceState(null, "", url);
            }}
        />
    );
}
