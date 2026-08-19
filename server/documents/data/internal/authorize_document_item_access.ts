import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {evaluateDeletedAccess} from "~/server/access/evaluate_deleted_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {
    documentDeletedErrorDisplayMessage,
    documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/documents/document_error_messages.js";
import {ErrorBase, NotFoundError} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";

type DocumentItemForAuthorization = Pick<
    DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">,
    "accessPolicy" | "deleted" | "documentId" | "spaceId"
>;

/** Authorizes access to a document attributes record. */
export async function authorizeDocumentItemAccess(
    context: ServerActionContext,
    documentItem: DocumentItemForAuthorization,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<void> {
    unwrapResult(
        await authorizeDocumentItemAccessIfPossible(
            context,
            documentItem,
            expectedAccessLevel,
            options,
        ),
    );
}

/**
 * Authorizes access to a document item, returning an error instead of throwing.
 */
export async function authorizeDocumentItemAccessIfPossible(
    context: ServerActionContext,
    documentItem: DocumentItemForAuthorization,
    expectedAccessLevel: AccessLevel,
    {
        consistency,
        dangerouslyAllowDeleted = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
    } = {},
): Promise<Result<void, ErrorBase>> {
    if (documentItem.deleted) {
        // If the actor couldn't view the document then use a "permission denied" error to
        // avoid leaking that the document was deleted.
        const result = await authorizeDocumentItemAccessAllowingDeletedIfPossible(
            context,
            documentItem,
            "View",
            {consistency},
        );
        if (!result.ok) return result;

        const hasDeletedAccess = await evaluateDeletedAccess(context, {
            spaceId: documentItem.spaceId,
            expectedAccessLevel,
            dangerouslyAllowDeleted,
        });

        if (!hasDeletedAccess) {
            return {
                ok: false,
                // NOTE(calebmer):Using `ErrorCode.NotFound` is important here. Consumers of this
                // error will render not found errors as "Deleted" and `ErrorCode.PermissionDenied`
                // as "Private".
                error: new NotFoundError("Document was deleted", {
                    aggregateDedupeKey: documentItem.documentId,
                    displayMessage: documentDeletedErrorDisplayMessage,
                }),
            };
        }
    }

    return await authorizeDocumentItemAccessAllowingDeletedIfPossible(
        context,
        documentItem,
        expectedAccessLevel,
        {consistency},
    );
}

async function authorizeDocumentItemAccessAllowingDeletedIfPossible(
    context: ServerActionContext,
    documentItem: DocumentItemForAuthorization,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    // Evaluate the document access policy.
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        documentItem.spaceId,
        documentItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: documentItem.spaceId,
            expectedAccessLevel,
            displayMessages: documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}
