import {importAllDynamoModules} from "~/server/dynamo/internal/import-all-dynamo-modules";

test("imports all modules in the DynamoDB directory", async () => {
    await importAllDynamoModules();
});

test("throws if an imported module exports a `DynamoTableSchema`", async () => {
    await expect(async () => {
        await importAllDynamoModules({shouldNotIgnoreTestCanaryFile: true});
    }).rejects.toThrow(
        'Module "server/dynamo/internal/import-all-dynamo-modules-test-canary.ts" exports a "DynamoTableSchema" as "TestCanaryTable", DynamoDB table schemas should be private to the module',
    );
});
