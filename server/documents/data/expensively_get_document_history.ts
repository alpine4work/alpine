import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeDocumentItemAccess} from "~/server/documents/data/internal/authorize_document_item_access.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {getDocumentItemForAuthorizationIfExists} from "~/server/documents/data/internal/get_document_item_for_authorization.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {
    DocumentHistoryAuthor,
    DocumentHistoryTransactionMetadata,
    documentHistoryDiffMaxStepCount,
} from "~/shared/documents/document_history_model.js";
import {addFallbackToDocumentTitle} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId, DocumentId, SiteId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

type DocumentStepTransactionItem =
    | DynamoTableItemType<typeof DocumentsTable, "Document", "StepTransactionsAfterSnapshot">
    | DynamoTableItemType<typeof DocumentsTable, "Document", "StepTransactionsBeforeSnapshot">;

/**
 * Expensively reads the document-history metadata needed by the history route.
 *
 * This is not performant for large, long-lived documents. It reads and
 * deserializes every stored step and inverse step, even though this route needs
 * only transaction metadata. It also loads every historical contributor before the
 * route can respond.
 *
 * This should be revisited.
 */
export async function expensivelyGetDocumentHistory(
    context: ServerActionContext,
    {
        id,
        onSiteId,
    }: {
        id: DocumentId;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<{
    title: string;
    transactions: Array<DocumentHistoryTransactionMetadata>;
    accounts: Array<AccountModel>;
    spaceId: SpaceId;
    version: number;
    initialVersion: {createdTime: Date; author: DocumentHistoryAuthor} | null;
}> {
    const documentItem = await getDocumentItemForAuthorizationIfExists(context, id);
    if (!documentItem) throw createDocumentNotFoundError(id);

    await authorizeDocumentItemAccess(context, documentItem, "Comment");
    const siteId = getSiteIdFromAccessPolicyIfExists(documentItem.accessPolicy);
    if (siteId) onSiteId?.(siteId);

    // Attributes retain the current title, so the route does not need to read a
    // snapshot.
    const title = addFallbackToDocumentTitle(documentItem.titleWithoutFallback);
    const initialVersion = {
        createdTime: documentItem.createdTime,
        author: documentItem.creator,
    };

    const initialVersionAccountId =
        initialVersion.author.from?.type === "Bot"
            ? initialVersion.author.from.accountId
            : initialVersion.author.id;

    if (documentItem.version === 0) {
        return {
            title,
            transactions: [],
            accounts: initialVersionAccountId
                ? [await getAccount(context, documentItem.spaceId, initialVersionAccountId)]
                : [],
            spaceId: documentItem.spaceId,
            version: documentItem.version,
            initialVersion,
        };
    }

    // TODO(#optimize-document-history): Persist a small, immutable history metadata
    // item for each transaction. Querying it would avoid reading this step payload to
    // build the list. Snapshot writes move transactions between these indexes. Read
    // both while a move is in progress, then deduplicate below.
    const readTransactions = async (
        sortRangeType: "StepTransactionsAfterSnapshot" | "StepTransactionsBeforeSnapshot",
    ): Promise<Array<DocumentStepTransactionItem>> =>
        await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                consistency: "Eventual",
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {sortRangeType, startVersion: 0},
                endSortKey: {sortRangeType, startVersion: documentItem.version - 1},
                descending: true,
                // TODO(#optimize-document-history): Return a cursor and load a bounded page of
                // history groups instead of every transaction in a document.
                limit: "All",
            }),
        );

    const [stepTransactionsAfterSnapshot, stepTransactionsBeforeSnapshot] = await runAllPromises([
        readTransactions("StepTransactionsAfterSnapshot"),
        readTransactions("StepTransactionsBeforeSnapshot"),
    ]);

    // Snapshot updates temporarily copy transactions between both sort ranges. Keep
    // one transaction for each version so pagination stays stable during that move.
    const transactionByStartVersion = new Map<number, DocumentStepTransactionItem>();
    for (const transaction of [
        ...stepTransactionsAfterSnapshot,
        ...stepTransactionsBeforeSnapshot,
    ]) {
        transactionByStartVersion.set(transaction.startVersion, transaction);
    }

    const allTransactions = Array.from(transactionByStartVersion.values()).sort(
        (transaction1, transaction2) => transaction2.startVersion - transaction1.startVersion,
    );

    const transactions = allTransactions.flatMap(transaction =>
        getDocumentHistoryTransactionChunks({
            transaction,
        }),
    );

    const accountIds = new Set([
        ...transactions.flatMap(transaction => {
            const accountId =
                transaction.author.from?.type === "Bot"
                    ? transaction.author.from.accountId
                    : transaction.author.id;
            return accountId ? [accountId] : [];
        }),
        ...(initialVersionAccountId ? [initialVersionAccountId] : []),
    ]);

    // TODO(#optimize-document-history): Load accounts only for the current history
    // page.
    const accounts = await runAllPromises(
        Array.from(accountIds, accountId => getAccount(context, documentItem.spaceId, accountId)),
    );

    return {
        title,
        transactions,
        accounts,
        spaceId: documentItem.spaceId,
        version: documentItem.version,
        initialVersion,
    };
}

/**
 * Splits a stored transaction into history comparisons that stay within the
 * reconstruction limit.
 */
function getDocumentHistoryTransactionChunks({
    transaction,
}: {
    transaction: DocumentStepTransactionItem;
}): Array<DocumentHistoryTransactionMetadata> {
    const endVersion = transaction.startVersion + transaction.steps.length;
    const metadata = {
        createdTime: transaction.createdTime,
        author: getDocumentHistoryAuthor({
            accountId: transaction.accountId,
            fromBotAccountId: transaction.fromBotAccountId,
        }),
        clientId: transaction.clientId,
    };

    const chunks: Array<DocumentHistoryTransactionMetadata> = [];

    // Emit the newest chunk first to preserve the reverse chronological history order.
    for (
        let chunkEndVersion = endVersion;
        chunkEndVersion > transaction.startVersion;
        chunkEndVersion -= documentHistoryDiffMaxStepCount
    ) {
        chunks.push({
            ...metadata,
            startVersion: Math.max(
                transaction.startVersion,
                chunkEndVersion - documentHistoryDiffMaxStepCount,
            ),
            endVersion: chunkEndVersion,
        });
    }

    return chunks;
}

/**
 * Preserves bot attribution and leaves attribution unknown for transactions that
 * predate account attribution.
 */
function getDocumentHistoryAuthor({
    accountId,
    fromBotAccountId,
}: {
    accountId: AccountId | null;
    fromBotAccountId: AccountId | null;
}): DocumentHistoryAuthor {
    return {
        id: accountId,
        from: fromBotAccountId ? {type: "Bot", accountId: fromBotAccountId} : null,
    };
}
