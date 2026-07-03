// IMPORTANT: We are only importing `@aws-sdk` for types. Use `aws4fetch` for
// executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTransactionEntry as DynamoTransactionEntryExternal} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {DynamoClientDebugItemType} from "~/server/dynamo/core/internal/dynamo_client_internal.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export type DynamoTransactionEntryInternal = InstanceType<typeof DynamoTransactionEntryInternal>;

/**
 * An entry within a DynamoDB write transaction. Entries within a transaction will
 * all succeed or fail together.
 *
 * Should be treated as an opaque object outside of `DynamoClient`.
 */
// The class is named `DynamoTransactionEntry` for `console.log()` debugging
// purposes but it should be referenced in code as
// `DynamoTransactionEntryInternal`.
export const DynamoTransactionEntryInternal = class DynamoTransactionEntry implements DynamoTransactionEntryExternal {
    declare readonly _DynamoTransactionEntry: never;

    readonly transactItem: types.TransactWriteItem;
    readonly isConditionCheckErrorRetriable: boolean;
    readonly debugItemType: DynamoClientDebugItemType;
    readonly onBeforeExecuteTransaction: ((context: DynamoContext) => MaybePromise<void>) | null;
    readonly onAfterTransactionExecutedSuccessfully:
        | ((context: DynamoContext) => MaybePromise<void>)
        | null;

    constructor({
        transactItem,
        isConditionCheckErrorRetriable,
        debugItemType,
        onBeforeExecuteTransaction,
        onAfterTransactionExecutedSuccessfully,
    }: {
        transactItem: types.TransactWriteItem;
        isConditionCheckErrorRetriable: boolean;
        debugItemType: DynamoClientDebugItemType;
        onBeforeExecuteTransaction: ((context: DynamoContext) => MaybePromise<void>) | null;
        onAfterTransactionExecutedSuccessfully:
            | ((context: DynamoContext) => MaybePromise<void>)
            | null;
    }) {
        this.transactItem = transactItem;
        this.isConditionCheckErrorRetriable = isConditionCheckErrorRetriable;
        this.debugItemType = debugItemType;
        this.onBeforeExecuteTransaction = onBeforeExecuteTransaction;
        this.onAfterTransactionExecutedSuccessfully = onAfterTransactionExecutedSuccessfully;
    }
};
