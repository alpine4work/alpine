import {TestCounter} from "~/shared/helpers/test/test_counter.js";

// Useful for testing caching logic within a DynamoDB action. If the number of
// executed actions doesn't increase that means we're hitting a cache.
export const dynamoClientExecuteActionTestCounter = new TestCounter<string>();
