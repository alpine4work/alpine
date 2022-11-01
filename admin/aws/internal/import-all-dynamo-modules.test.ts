import {importAllDynamoModules} from "~/admin/aws/internal/import-all-dynamo-modules";
import {noop} from "~/shared/helpers/control/noop";

// When we run tests we set the Jest `afterEach` and friends hooks to `noop` so
// that when we import all DynamoDB modules they don't error when they try to
// register a hook.
let originalBeforeAll: jest.Lifecycle;
let originalBeforeEach: jest.Lifecycle;
let originalAfterAll: jest.Lifecycle;
let originalAfterEach: jest.Lifecycle;

beforeEach(() => {
    originalBeforeAll = globalThis.beforeAll;
    originalBeforeEach = globalThis.beforeEach;
    originalAfterAll = globalThis.afterAll;
    originalAfterEach = globalThis.afterEach;

    globalThis.beforeAll = noop;
    globalThis.beforeEach = noop;
    globalThis.afterAll = noop;
    globalThis.afterEach = noop;
});

afterEach(() => {
    globalThis.beforeAll = originalBeforeAll;
    globalThis.beforeEach = originalBeforeEach;
    globalThis.afterAll = originalAfterAll;
    globalThis.afterEach = originalAfterEach;
});

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
