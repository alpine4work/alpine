import {Node} from "prosemirror-model";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {applyHistoricalDocumentStep} from "~/server/documents/data/internal/apply_historical_document_step.js";
import {authorizeDocumentItemAccess} from "~/server/documents/data/internal/authorize_document_item_access.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {getDocumentContentStepsBetweenValidatedVersionRange} from "~/server/documents/data/internal/get_document_content_steps_between_validated_version_range.js";
import {getDocumentItemForAuthorizationIfExists} from "~/server/documents/data/internal/get_document_item_for_authorization.js";
import {
    DocumentContent,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Reconstructs document content at an existing persisted version.
 *
 * The document snapshot anchors reconstruction. Stored steps move forward from it,
 * while inverted steps move backward.
 */
export async function getDocumentContentAtVersion(
    context: ServerActionContext,
    {id, version}: {id: DocumentId; version: number},
): Promise<DocumentContent> {
    const documentItem = await getDocumentItemForAuthorizationIfExists(context, id);
    if (!documentItem) throw createDocumentNotFoundError(id);

    await authorizeDocumentItemAccess(context, documentItem, "Comment");

    if (!Number.isSafeInteger(version) || version < 0)
        throw new InvalidArgumentError("Document version must be a non-negative integer");
    if (version > documentItem.version)
        throw new FailedPreconditionError(
            "Document version is greater than the last version in the document",
        );

    const snapshot = await DocumentsTable.getItemIfExists(context, {
        partitionType: "Document",
        documentId: id,
        sortRangeType: "Snapshot",
    });
    if (!snapshot) throw new DataLossError("Missing document snapshot");
    if (version === snapshot.version) return snapshot.content;

    // Read the contiguous step range needed to reach the requested version from the
    // snapshot, regardless of whether that version comes before or after it.
    const steps = await getDocumentContentStepsBetweenValidatedVersionRange(context, {
        id,
        startVersion: Math.min(version, snapshot.version),
        endVersion: Math.max(version, snapshot.version),
    });

    let content: Node = snapshot.content;
    if (version > snapshot.version) {
        for (const {step} of steps) content = applyHistoricalDocumentStep(content, step);
    } else {
        for (let index = steps.length - 1; index >= 0; index--) {
            content = applyHistoricalDocumentStep(content, assertExists(steps[index]).invertedStep);
        }
    }
    return assertDocumentContent(content);
}
