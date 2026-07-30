/**
 * Opaque, nominal handle for an entry in a DynamoDB transaction. The actual
 * implementation lives in
 * `server/dynamo/core/internal/dynamo_transaction_entry_internal.ts`, which
 * constructs and inspects entries through a module-private symbol. From outside
 * that file the value is fully opaque: it can be held in variables and passed
 * through function signatures, but its internals can't be read or constructed.
 */
export type DynamoTransactionEntry = {
    readonly _DynamoTransactionEntry: never;
};
