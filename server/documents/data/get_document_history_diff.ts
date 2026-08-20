import {Node, Slice} from "prosemirror-model";
import {ReplaceStep, Step} from "prosemirror-transform";
import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    FileDocumentAuthorizer,
    batchGetDocumentCommentThreadReferencesIfExists,
} from "~/server/documents/data/documents_actions.js";
import {getDocumentContentAtVersion} from "~/server/documents/data/get_document_content_at_version.js";
import {applyHistoricalDocumentStep} from "~/server/documents/data/internal/apply_historical_document_step.js";
import {authorizeDocumentItemAccess} from "~/server/documents/data/internal/authorize_document_item_access.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {getDocumentContentStepsBetweenValidatedVersionRange} from "~/server/documents/data/internal/get_document_content_steps_between_validated_version_range.js";
import {getDocumentItemForAuthorizationIfExists} from "~/server/documents/data/internal/get_document_item_for_authorization.js";
import {getReferencedDocumentCommentThreadIds} from "~/server/documents/data/internal/get_referenced_document_comment_thread_ids.js";
import {
    DocumentContentReferences,
    mergeDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {documentHistoryDiffMaxStepCount} from "~/shared/documents/document_history_model.js";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Reconstructs a bounded document-history comparison and its render references.
 */
export async function getDocumentHistoryDiff(
    context: ServerActionContext,
    {
        id,
        startVersion,
        endVersion,
        showInitialContentAsAdditions = false,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
        showInitialContentAsAdditions?: boolean;
    },
): Promise<{
    startContent: DocumentContent;
    steps: Array<Step>;
    contentReferences: DocumentContentReferences;
}> {
    const documentItem = await getDocumentItemForAuthorizationIfExists(context, id);
    if (!documentItem) throw createDocumentNotFoundError(id);

    await authorizeDocumentItemAccess(context, documentItem, "Comment");

    if (!Number.isSafeInteger(startVersion) || startVersion < 0)
        throw new InvalidArgumentError(
            "Document history start version must be a non-negative integer",
        );
    if (!Number.isSafeInteger(endVersion) || endVersion < 0)
        throw new InvalidArgumentError(
            "Document history end version must be a non-negative integer",
        );
    if (startVersion > endVersion)
        throw new InvalidArgumentError(
            "Document history start version must not be greater than end version",
        );
    if (endVersion > documentItem.version)
        throw new FailedPreconditionError(
            "Document history end version is greater than the last version in the document",
        );
    if (endVersion - startVersion > documentHistoryDiffMaxStepCount)
        throw new InvalidArgumentError(
            `Document history comparisons may contain at most ${documentHistoryDiffMaxStepCount} steps`,
        );
    if (startVersion === endVersion && startVersion !== 0)
        throw new InvalidArgumentError(
            "Document history comparisons without changes require version 0",
        );

    const shouldShowInitialContentAsAdditions =
        showInitialContentAsAdditions || startVersion === endVersion;
    const initialContent = shouldShowInitialContentAsAdditions
        ? await getDocumentContentAtVersion(context, {id, version: 0})
        : null;

    if (startVersion === endVersion) {
        if (!initialContent) throw new DataLossError("Missing initial document content");
        const startContent = createEmptyDocumentContentForInitialDocumentHistory(initialContent);
        return {
            startContent,
            steps: [
                new ReplaceStep(
                    0,
                    startContent.content.size,
                    new Slice(initialContent.content, 0, 0),
                ),
            ],
            contentReferences: await getDocumentHistoryContentReferences(context, {
                documentId: id,
                spaceId: documentItem.spaceId,
                content: initialContent,
            }),
        };
    }

    const snapshot = await DocumentsTable.getItemIfExists(context, {
        partitionType: "Document",
        documentId: id,
        sortRangeType: "Snapshot",
    });

    if (!snapshot) throw new DataLossError("Missing document snapshot");

    // TODO(#optimize-document-history): Enforce a maximum number of steps to
    // reconstruct for a history comparison.
    const rangeStartVersion = Math.min(startVersion, snapshot.version);
    const rangeEndVersion = Math.max(endVersion, snapshot.version);

    // Load one continuous range around the snapshot so the selected start and end
    // versions use the same persisted step sequence.
    const stepsAroundSnapshot = await getDocumentContentStepsBetweenValidatedVersionRange(context, {
        id,
        startVersion: rangeStartVersion,
        endVersion: rangeEndVersion,
    });

    const startStepOffset = startVersion - rangeStartVersion;
    const endStepOffset = endVersion - rangeStartVersion;
    const snapshotStepOffset = snapshot.version - rangeStartVersion;
    const comparisonSteps = stepsAroundSnapshot.slice(startStepOffset, endStepOffset);

    // Move the snapshot in the direction of the selected start version.
    let startContent: Node = snapshot.content;
    if (startVersion < snapshot.version) {
        for (let index = snapshotStepOffset - 1; index >= startStepOffset; index--) {
            startContent = applyHistoricalDocumentStep(
                startContent,
                assertExists(stepsAroundSnapshot[index]).invertedStep,
            );
        }
    } else {
        for (const {step} of stepsAroundSnapshot.slice(snapshotStepOffset, startStepOffset)) {
            startContent = applyHistoricalDocumentStep(startContent, step);
        }
    }

    const reconstructedStartContent = assertDocumentContent(startContent);
    const initialStartContent = initialContent
        ? createEmptyDocumentContentForInitialDocumentHistory(initialContent)
        : null;

    // The selected comparison steps now move from the reconstructed start to end.
    let endContent: Node = reconstructedStartContent;
    for (const {step} of comparisonSteps) {
        endContent = applyHistoricalDocumentStep(endContent, step);
    }

    const reconstructedEndContent = assertDocumentContent(endContent);

    // Deleted entities can exist only in the starting version, so load renderer
    // references for both sides of the comparison.
    const [startContentReferences, endContentReferences] = await runAllPromises([
        getDocumentHistoryContentReferences(context, {
            documentId: id,
            spaceId: documentItem.spaceId,
            content: reconstructedStartContent,
        }),
        getDocumentHistoryContentReferences(context, {
            documentId: id,
            spaceId: documentItem.spaceId,
            content: reconstructedEndContent,
        }),
    ]);

    // File references include signed URLs, which are request-scoped and cannot be
    // combined with the live-content merge helper. When the same file appears in both
    // versions, prefer the ending version's reference; both versions render the same
    // immutable file.
    const startContentReferencesWithUniqueFiles =
        startContentReferences.fileById && endContentReferences.fileById
            ? {
                  ...startContentReferences,
                  fileById: new Map(
                      [...startContentReferences.fileById].filter(
                          ([fileId]) => !endContentReferences.fileById?.has(fileId),
                      ),
                  ),
              }
            : startContentReferences;

    return {
        startContent: initialStartContent ?? reconstructedStartContent,
        steps: [
            ...(initialContent && initialStartContent
                ? [
                      new ReplaceStep(
                          0,
                          initialStartContent.content.size,
                          new Slice(initialContent.content, 0, 0),
                      ),
                  ]
                : []),
            ...comparisonSteps.map(({step}) => step),
        ],
        contentReferences: mergeDocumentContentReferences(
            startContentReferencesWithUniqueFiles,
            endContentReferences,
        ),
    };
}

function createEmptyDocumentContentForInitialDocumentHistory(
    initialContent: DocumentContent,
): DocumentContent {
    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node(
            "doc",
            {accessPolicy: initialContent.attrs.accessPolicy},
            [
                DocumentContentProsemirrorSchema.node("title"),
                DocumentContentProsemirrorSchema.node("paragraph"),
            ],
        ),
    );
}

/**
 * Loads the renderer references required by one reconstructed document version.
 */
async function getDocumentHistoryContentReferences(
    context: ServerActionContext,
    {
        documentId,
        spaceId,
        content,
    }: {
        documentId: DocumentId;
        spaceId: SpaceId;
        content: DocumentContent;
    },
): Promise<DocumentContentReferences> {
    const commentThreadIds = getReferencedDocumentCommentThreadIds(content);
    const accessPolicy = content.attrs.accessPolicy;
    const siteId = accessPolicy.type === "Site" ? accessPolicy.siteId : null;
    const [contentReferences, {commentThreadById}, siteById] = await runAllPromises([
        getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
            context,
            spaceId,
            FileDocumentAuthorizer.bind({type: "Document", documentId}),
            content,
        ),
        commentThreadIds.size > 0
            ? batchGetDocumentCommentThreadReferencesIfExists(context, {
                  documentId,
                  commentThreadIds,
              })
            : {
                  commentThreadById: new Map<never, never>(),
                  resolvedCommentThreadIds: new Set<never>(),
              },
        siteId
            ? context.sitesInjection.getSitePreview(siteId).then(site => new Map([[siteId, site]]))
            : new Map(),
    ]);

    return {...contentReferences, commentThreadById, siteById};
}
