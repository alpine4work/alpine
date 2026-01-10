import {ShouldRevalidateFunction, useParams, useSearchParams} from "@remix-run/react";
import {useEffect, useState} from "react";
import {
    deserializeDocumentIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {
    DocumentContentEditor,
    DocumentContentEditorInitialScroll,
} from "~/client/web/documents/document_content_editor.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix, useUpdateMetaTitle} from "~/client/web/remix/use_update_meta_title.js";
import {markSearchAffinityLowIntentUpdateEntityInteraction} from "~/client/web/search/mark_search_affinity_low_intent_update_entity_interaction.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    getDocumentCommentThreadAndInitialComments,
    getDocumentWithOptionalCommentsIfExists,
} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {
    createEmptySpellCheckIgnoredLintsForNewEntity,
    getSpellCheckIgnoredLints,
} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {
    DynamoGeneralRealtimeQueryResult,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema().nullable(),
    commentThreadResult: Schema.object({
        checkpoint: ServerSynchronizationCheckpointSchema,
        commentThread: DocumentCommentThreadModel.schema(),
        initialComments: Schema.array(DocumentCommentModel.schema()),
        initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
    }).nullable(),
    isFavorite: Schema.boolean,
    spellCheckIgnoredLints: createDynamoGeneralRealtimeQuerySchema(
        SpellCheckIgnoredLintModel.schema(),
    ),
});

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const commentThreadId = Schema.id<DocumentCommentThreadId>()
        .nullable()
        .deserialize(url.searchParams.get("comments"));

    const [document, commentThreadResultResult, isFavorite, spellCheckIgnoredLintsResult] =
        await runAllPromises([
            getDocumentWithOptionalCommentsIfExists(context, documentId),
            commentThreadId
                ? captureResultPromise(async () => {
                      // Generate checkpoint before we start loading data. So when we backfill we
                      // include any realtime events that happened while loading data.
                      const checkpoint = generateServerSynchronizationCheckpoint();

                      const output = await getDocumentCommentThreadAndInitialComments(context, {
                          documentId,
                          commentThreadId,
                          limit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                      });

                      return {checkpoint, ...output};
                  })
                : null,
            isSearchFavoriteEntity(context, {
                spaceId,
                entityId: `Document:${documentId}`,
            }),
            captureResultPromise(getSpellCheckIgnoredLints(context, `Document:${documentId}`)),
        ]);

    // Don't throw a "actor doesn't have comment" permission error if the actor
    // doesn't have view access to the document.
    const commentThreadResult = commentThreadResultResult
        ? unwrapResult(commentThreadResultResult)
        : null;

    let spellCheckIgnoredLints: DynamoGeneralRealtimeQueryResult<SpellCheckIgnoredLintModel>;

    if (!document) {
        // Must have the `create` search param to load a document that doesn't exist.
        if (url.searchParams.get("create") !== "") {
            throw createDocumentNotFoundError(documentId);
        }

        // We don't have a document yet, so we can't fetch spell check ignored lints.
        spellCheckIgnoredLints = createEmptySpellCheckIgnoredLintsForNewEntity(
            `Document:${documentId}`,
        );
    } else {
        // We have a document and successfully loaded the spell check ignored lints.
        spellCheckIgnoredLints = unwrapResult(spellCheckIgnoredLintsResult);
    }

    return jsonWithSchema(LoaderSchema, {
        document,
        commentThreadResult,
        isFavorite,
        spellCheckIgnoredLints,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => [
    {title: document?.getTitle() ?? documentFallbackTitle},
]);

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: originalCurrentUrl,
    nextUrl: originalNextUrl,
}) => {
    const currentUrl = new URL(originalCurrentUrl);
    const nextUrl = new URL(originalNextUrl);

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

// TODO(calebmer): Documents shared via URL (where `accessPolicy.urlGrant` is
// non-null) on iOS Safari don't hide the bottom bar when the user scrolls down
// because we don't use `<body>` scrolling. Instead we have an inner scroll
// view which breaks Safari's nice "hide bottom bar on scroll" interaction.
//
// Ideally we'd have a special code path that uses `<body>` scrolling just for
// documents shared via URL.
export default function DocumentRoute() {
    const {
        document: initialDocument,
        commentThreadResult: initialCommentThreadResult,
        isFavorite: initialIsFavorite,
        spellCheckIgnoredLints: initialSpellCheckIgnoredLints,
    } = useLoaderDataWithSchema(LoaderSchema);
    const params = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const updateMetaTitle = useUpdateMetaTitle();
    const context = useAppContext();
    const {space} = useSpaceContext();

    const documentId = deserializeDocumentIdForLoader(params.documentId);

    const [shouldInitiallyFocus] = useState(searchParams.get("focus") === "");

    const commentIndexString = searchParams.get("comment");
    const commentIndex = commentIndexString ? parseInt(commentIndexString, 10) : null;

    const [initialScroll] = useState((): DocumentContentEditorInitialScroll | null => {
        if (commentIndex !== null) return {type: "CommentInOpenThread", commentIndex};

        const scrollString = searchParams.get("scroll");
        if (!scrollString) return null;

        // NOTE(calebmer): Prefix with `comments-` since in the future I could see us
        // initially scrolling to headings or other things in the document.
        if (scrollString.startsWith("comments-")) {
            const commentThreadId = scrollString.slice(9);
            if (!isId<DocumentCommentThreadId>(commentThreadId)) {
                throw new InvalidArgumentError("Expected `DocumentCommentThreadId`");
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

    // Don't update affinity score while creating.
    useSearchAffinityViewEntityInteraction(!isCreating ? `Document:${documentId}` : null);

    return (
        <DocumentContentEditor
            // Re-render when the document changes
            key={documentId}
            documentId={documentId}
            initialDocument={initialDocument}
            initialCommentThreadResult={initialCommentThreadResult}
            initialIsFavorite={initialIsFavorite}
            initialScroll={initialScroll}
            initialSpellCheckIgnoredLints={initialSpellCheckIgnoredLints}
            shouldInitiallyFocus={shouldInitiallyFocus}
            onCreate={() => setIsCreating(false)}
            onContentChange={content => {
                updateMetaTitle(`${getDocumentContentTitle(content)}${metaTitlePostfix}`);
            }}
            onContentLocalChange={() => {
                // Don't update affinity score while creating.
                if (isCreating) return;

                markSearchAffinityLowIntentUpdateEntityInteraction(
                    context,
                    space.id,
                    `Document:${documentId}`,
                    {isVeryLow: true},
                );
            }}
            onCommentThreadChange={commentThreadId => {
                const newSearchParams = new URLSearchParams(searchParams);
                if (commentThreadId) {
                    newSearchParams.set("comments", commentThreadId);
                    newSearchParams.delete("comment");
                } else {
                    newSearchParams.delete("comments");
                    newSearchParams.delete("comment");
                }

                setSearchParams(newSearchParams, {
                    replace: true,
                    unstable_shouldRevalidate: false,
                });
            }}
        />
    );
}
