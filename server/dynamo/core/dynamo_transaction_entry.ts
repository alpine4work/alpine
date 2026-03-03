// IMPORTANT: We are only importing `@aws-sdk` for types. Use `aws4fetch` for
// executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoClient} from "~/server/dynamo/core/internal/dynamo_client.js";
import {DynamoClientDebugItemType} from "~/server/dynamo/core/internal/dynamo_client_internal.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * An entry within a DynamoDB write transaction. Entries within a transaction will
 * all succeed or fail together.
 *
 * Should be treated as an opaque object outside of `DynamoClient`.
 */
export class DynamoTransactionEntry {
    private readonly _transactItem: types.TransactWriteItem;
    public readonly isConditionCheckErrorRetriable: boolean;
    private readonly _onBeforeExecuteTransactionCallback:
        | ((context: DynamoContext) => MaybePromise<void>)
        | null;
    private readonly _onAfterTransactionExecutedSuccessfullyCallback:
        | ((context: DynamoContext) => MaybePromise<void>)
        | null;
    public readonly debugItemType: DynamoClientDebugItemType;

    private constructor(
        transactItem: types.TransactWriteItem,
        isConditionCheckErrorRetriable: boolean,
        onBeforeExecuteTransaction: ((context: DynamoContext) => MaybePromise<void>) | null,
        onAfterTransactionExecutedSuccessfully:
            | ((context: DynamoContext) => MaybePromise<void>)
            | null,
        debugItemType: DynamoClientDebugItemType,
    ) {
        this._transactItem = transactItem;
        this.isConditionCheckErrorRetriable = isConditionCheckErrorRetriable;
        this._onBeforeExecuteTransactionCallback = onBeforeExecuteTransaction;
        this._onAfterTransactionExecutedSuccessfullyCallback =
            onAfterTransactionExecutedSuccessfully;
        this.debugItemType = debugItemType;
    }

    /**
     * Should not call this outside of `DynamoClient`! Use functions like
     * `DynamoClient.transactionCreateItem()` instead. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient` which
     * is in an internal directory.
     */
    public static _newFromClient(
        client: typeof DynamoClient,
        {
            transactItem,
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully,
            debugItemType,
        }: {
            transactItem: types.TransactWriteItem;
            isConditionCheckErrorRetriable: boolean;
            onBeforeExecuteTransaction: ((context: DynamoContext) => MaybePromise<void>) | null;
            onAfterTransactionExecutedSuccessfully:
                | ((context: DynamoContext) => MaybePromise<void>)
                | null;
            debugItemType: DynamoClientDebugItemType;
        },
    ) {
        return new DynamoTransactionEntry(
            transactItem,
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully,
            debugItemType,
        );
    }

    /**
     * Should not call this outside of `DynamoClient`! A transaction entry should be
     * treated as an opaque object outside of this file. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient` which
     * is in an internal directory.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public _getTransactItemForClient(client: typeof DynamoClient): types.TransactWriteItem {
        return this._transactItem;
    }

    /**
     * Should not call this outside of `DynamoClient`! A transaction entry should be
     * treated as an opaque object outside of this file. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient` which
     * is in an internal directory.
     */
    public _onBeforeExecuteTransaction(
        client: typeof DynamoClient,
        context: DynamoContext,
    ): MaybePromise<void> {
        return this._onBeforeExecuteTransactionCallback?.(context);
    }

    /**
     * Should not call this outside of `DynamoClient`! A transaction entry should be
     * treated as an opaque object outside of this file. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient` which
     * is in an internal directory.
     */
    public _onAfterTransactionExecutedSuccessfully(
        client: typeof DynamoClient,
        context: DynamoContext,
    ): MaybePromise<void> {
        return this._onAfterTransactionExecutedSuccessfullyCallback?.(context);
    }
}
