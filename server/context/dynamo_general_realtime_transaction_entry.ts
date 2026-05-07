/**
 * Opaque, nominal handle for an entry in a general-realtime DynamoDB transaction.
 * The actual implementation lives in
 * `//server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.ts`,
 * which constructs and inspects entries through a module-private symbol. From
 * outside that file the value is fully opaque: it can be held in variables and
 * passed through function signatures, but its internals can't be read or
 * constructed.
 *
 * The type lives in `//server/context` so injection slots can reference it without
 * taking a Bazel dependency on `//server/dynamo/core/general_realtime`, which
 * would create a circular dependency (`general_realtime` already depends on
 * `context`).
 */
export type DynamoGeneralRealtimeTransactionEntry = {
    readonly _DynamoGeneralRealtimeTransactionEntry: never;
};
