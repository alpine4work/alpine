import {TestCounter} from "~/shared/helpers/test/test_counter.js";

// Useful for testing caching logic within a DynamoDB action. The number of
// `GetItem` actions (and if `BatchGetItem`, the number of items read in the
// batch).
export const dynamoClientGetItemTestCounter = new TestCounter<string>();
