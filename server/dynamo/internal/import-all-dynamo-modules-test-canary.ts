import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {assert} from "~/shared/helpers/control/assert";

assert(process.env.NODE_ENV === "test");

/**
 * Hackishly create an object that looks like a `DynamoTableSchema` when you do
 * `value instanceof DynamoTableSchema`. We don't actually want to create an
 * actual table in AWS for this so we use `Object.create()` instead of the
 * standard `new DynamoTableSchema()`.
 *
 * We use this to test that `importAllDynamoModules()` fails when it sees a
 * `DynamoTableSchema`. The name "canary" comes from "canary in the coal mine".
 */
export const TestCanaryTable = Object.create(DynamoTableSchema.prototype);
