// IMPORTANT: We are only importing `@aws-sdk` for types. Use `aws-client.ts`
// for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {dynamoClient} from "~/server/dynamo/internal/dynamo-client";

/**
 * An entry within a DynamoDB write transaction. Entries within a transaction
 * will all succeed or fail together.
 *
 * Should be treated as an opaque object outside of `DynamoClient`.
 */
export class DynamoTransactionEntry {
    private constructor(private readonly _transactItem: types.TransactWriteItem) {}

    /**
     * Should not call this outside of `DynamoClient`! Use functions like
     * `DynamoClient.transactionPutItem()` instead. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient`
     * which is in an internal directory.
     */
    public static _newFromClient(
        client: typeof dynamoClient,
        transactItem: types.TransactWriteItem,
    ) {
        return new DynamoTransactionEntry(transactItem);
    }

    /**
     * Should not call this outside of `DynamoClient`! A transaction entry should
     * be treated as an opaque object outside of this file. We require you to pass
     * in a `DynamoClient` to make sure you at least have access to a
     * `DynamoClient` which is in an internal directory..
     */
    public _getTransactItemForClient(client: typeof dynamoClient): types.TransactWriteItem {
        return this._transactItem;
    }
}
