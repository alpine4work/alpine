import {ShouldRevalidateFunction, useParams, useSearchParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {
    DocumentContentEditor,
    DocumentContentEditorInitialScroll,
} from "~/client/documents/document_content_editor.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/remix/use_update_meta_title.js";
import {markSearchAffinityLowIntentUpdateInteraction} from "~/client/search/mark_search_affinity_low_intent_update_interaction.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    getDocumentCommentThreadAndInitialComments,
    getDocumentIfExists,
} from "~/server/documents/data/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema().nullable(),
    commentThreadResult: Schema.object({
        commentThread: DocumentCommentThreadModel.schema(),
        initialComments: Schema.array(DocumentCommentModel.schema()),
        initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
    }).nullable(),
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);
    const commentThreadId = Schema.id<DocumentCommentThreadId>()
        .nullable()
        .deserialize(url.searchParams.get("comments"));

    const [document, commentThreadResult] = await runAllPromises([
        getDocumentIfExists(context, documentId),
        commentThreadId
            ? getDocumentCommentThreadAndInitialComments(context, {
                  documentId,
                  commentThreadId,
                  limit: getInitialLoadMessageCount(context.loader.getClientInfo()),
              })
            : null,
    ]);

    // Must have the `create` search param to load a document that doesn't exist.
    if (!document && url.searchParams.get("create") !== "") {
        throw new NotFoundError("Document not found");
    }

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document, commentThreadResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => [
    {title: document?.getTitle() ?? documentFallbackTitle},
]);

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // Used when creating documents:
    nextUrl.searchParams.delete("create");
    currentUrl.searchParams.delete("create");

    // Used to open a comment thread:
    nextUrl.searchParams.delete("comments");
    currentUrl.searchParams.delete("comments");

    // Used to scroll to a specific comment in a comment thread:
    nextUrl.searchParams.delete("comment");
    currentUrl.searchParams.delete("comment");

    // Used to scroll somewhere in the document:
    nextUrl.searchParams.delete("scroll");
    currentUrl.searchParams.delete("scroll");

    // Used to initially focus the document:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function DocumentRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const {document: initialDocument, commentThreadResult} = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const updateMetaTitle = useUpdateMetaTitle();
    const context = useAppContext();
    const {space} = useSpaceContext();

    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);

    const focusSearchParam = searchParams.get("focus");
    const [shouldInitiallyFocus] = useState(focusSearchParam === "");

    const [initialScroll] = useState((): DocumentContentEditorInitialScroll | null => {
        const scrollString = searchParams.get("scroll");
        if (!scrollString) return null;

        // NOTE(calebmer): Prefix with `comments-` since in the future I could see us
        // initially scrolling to headings or other things in the document.
        if (scrollString.startsWith("comments-")) {
            const commentThreadId = scrollString.slice(9);
            if (!isId<DocumentCommentThreadId>(commentThreadId)) {
                throw new InvalidArgumentError("Expected comment thread ID");
            }
            return {type: "CommentThread", commentThreadId};
        }

        return null;
    });

    const [isCreating, setIsCreating] = useState(initialDocument === null);

    // Remove the `focus` search param.
    useEffect(() => {
        if (searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    // Remove the `create` search param.
    useEffect(() => {
        if (!isCreating && searchParams.has("create")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("create");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [isCreating, searchParams, setSearchParams]);

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    // Don't update affinity score while creating.
    useSearchAffinityViewInteraction(!isCreating ? `Document:${documentId}` : null);

    return (
        <DocumentContentEditor
            // Re-render when the document changes
            key={documentId}
            withMobileLayout={withMobileLayout}
            documentId={documentId}
            initialDocument={initialDocument}
            initialCommentThreadResult={commentThreadResult}
            // Scrolling to an initial comment index is a little different than
            // `initialScroll` since it depends on the comment thread being opened.
            initialScrollToCommentIndex={commentIndex}
            initialScroll={initialScroll}
            shouldInitiallyFocus={shouldInitiallyFocus}
            onCreate={() => setIsCreating(false)}
            onContentChange={content => {
                updateMetaTitle(`${getDocumentContentTitle(content)}${metaTitlePostfix}`);
            }}
            onContentLocalChange={() => {
                // Don't update affinity score while creating.
                if (isCreating) return;

                markSearchAffinityLowIntentUpdateInteraction(
                    context,
                    space.id,
                    `Document:${documentId}`,
                    {isVeryLow: true},
                );
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
                //
                // TODO(calebmer): Globally replacing the URL doesn't work in peeks! Eventually
                // migrate this to `useSearchParams()` + `shouldRevalidate` to avoid a server
                // fetch.
                window.history.replaceState(window.history.state, "", url);
            }}
        />
    );
}
