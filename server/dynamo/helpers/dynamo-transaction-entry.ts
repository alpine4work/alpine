import {TransactWriteItem} from "@aws-sdk/client-dynamodb";
import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";

/**
 * An entry within a DynamoDB write transaction. Entries within a transaction
 * will all succeed or fail together.
 *
 * Should be treated as an opaque object outside of `DynamoClient`.
 */
export class DynamoTransactionEntry {
    private constructor(private readonly _transactItem: TransactWriteItem) {}

    /**
     * Should not call this outside of `DynamoClient`! Use functions like
     * `DynamoClient.transactionPutItem()` instead. We require you to pass in a
     * `DynamoClient` to make sure you at least have access to a `DynamoClient`.
     */
    public static _newFromClient(client: DynamoClient, transactItem: TransactWriteItem) {
        return new DynamoTransactionEntry(transactItem);
    }

    /**
     * Should not call this outside of `DynamoClient`! A transaction entry should
     * be treated as an opaque object outside of this file. We require you to pass
     * in a `DynamoClient` to make sure you at least have access to a
     * `DynamoClient`.
     */
    public _getTransactItemForClient(client: DynamoClient): TransactWriteItem {
        return this._transactItem;
    }
}
