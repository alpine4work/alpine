import {createAccountForTest} from "~/server/accounts/create_account_for_test.js";
import {incrementLocalDynamoTableSchemaGenerationForTest} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoClientInternal} from "~/server/dynamo/core/internal/dynamo_client_internal.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const context = createTestContext();

describe("DynamoTableSchema._ensureLocalTable", () => {
    beforeEach(() => {
        import.meta.jest.restoreAllMocks();
    });
    afterEach(async () => {
        await context.resetDynamoLocal();
    });

    test("parallel calls only call DescribeTable once", async () => {
        const dynamoClientSpy = import.meta.jest.spyOn(
            DynamoClientInternal.prototype,
            "DescribeTable",
        );
        await runAllPromises([
            createAccountForTest(context, {name: "Test 1"}),
            createAccountForTest(context, {name: "Test 2"}),
            createAccountForTest(context, {name: "Test 3"}),
        ]);
        expect(dynamoClientSpy).toHaveBeenCalledTimes(1);
    });

    test("sequential calls in same generation calls DescribeTable only once", async () => {
        const dynamoClientSpy = import.meta.jest.spyOn(
            DynamoClientInternal.prototype,
            "DescribeTable",
        );
        await createAccountForTest(context, {name: "Test 1"});
        await createAccountForTest(context, {name: "Test 2"});
        await createAccountForTest(context, {name: "Test 3"});
        expect(dynamoClientSpy).toHaveBeenCalledTimes(1);
    });

    test("updating local table generation counter calls DescribeTable again", async () => {
        const dynamoClientSpy = import.meta.jest.spyOn(
            DynamoClientInternal.prototype,
            "DescribeTable",
        );
        await createAccountForTest(context, {name: "Test 1"});
        await createAccountForTest(context, {name: "Test 2"});
        expect(dynamoClientSpy).toHaveBeenCalledTimes(1);
        incrementLocalDynamoTableSchemaGenerationForTest();
        await createAccountForTest(context, {name: "Test 3"});
        expect(dynamoClientSpy).toHaveBeenCalledTimes(2);
    });

    test("tables not created before incrementing local table generation counter still get created", async () => {
        await createAccountForTest(context, {name: "Test 1"});
        incrementLocalDynamoTableSchemaGenerationForTest();
        const space = await TestSpace.create(context, {name: "Test Space"});
        expect(space).toBeDefined();
    });
});
