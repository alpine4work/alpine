import {
    createAccountForTest,
    createSessionForTest,
} from "~/server/accounts/create_account_for_test.js";
import {getSessionIfExists} from "~/server/accounts/get_session_if_exists.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.open_source.js";

import.meta.jest.useFakeTimers();

const context = createTestContext();

async function createSessionForGetSessionTest() {
    const accountId = generateId<AccountId>();
    const sessionId = generateId<SessionId>();

    await createAccountForTest(context, {
        id: accountId,
        name: "Test account",
    });
    await createSessionForTest(context, {id: sessionId, accountId});

    return {accountId, sessionId};
}

async function revokeSessionForGetSessionTest(sessionId: SessionId) {
    await AccountsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId,
    });
}

test("does not refetch from DynamoDB before 15 seconds", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    dynamoClientExecuteActionTestCounter.resetForTest();

    import.meta.jest.advanceTimersByTime(1000 * 15 - 1);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    expect(getCount()).toEqual(0);
});

test("refetches in the background after 15 seconds", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    dynamoClientExecuteActionTestCounter.resetForTest();

    import.meta.jest.advanceTimersByTime(1000 * 15);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    await ProcessContextModule.waitForTestTasks();
    expect(getCount()).toEqual(1);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    expect(getCount()).toEqual(1);

    import.meta.jest.advanceTimersByTime(1000 * 15);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    await ProcessContextModule.waitForTestTasks();
    expect(getCount()).toEqual(2);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    expect(getCount()).toEqual(2);
});

test("refetches after 30 seconds", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    dynamoClientExecuteActionTestCounter.resetForTest();

    import.meta.jest.advanceTimersByTime(1000 * 30);

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    expect(getCount()).toEqual(1);
});

test("revalidates revoked sessions in the background after 15 seconds", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    await revokeSessionForGetSessionTest(sessionId);
    dynamoClientExecuteActionTestCounter.resetForTest();

    import.meta.jest.advanceTimersByTime(1000 * 15);

    // The value from the old cache is returned immediately.
    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    await ProcessContextModule.waitForTestTasks();
    expect(getCount()).toEqual(2);

    // After background revalidation completes, the cached session is revoked.
    expect(await getSessionIfExists(context, sessionId)).toEqual(null);
    expect(getCount()).toEqual(2);
});

test("after 30 seconds, revoked sessions block and refetch from DynamoDB", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();

    expect(await getSessionIfExists(context, sessionId)).toEqual(accountId);
    await revokeSessionForGetSessionTest(sessionId);
    dynamoClientExecuteActionTestCounter.resetForTest();

    import.meta.jest.advanceTimersByTime(1000 * 30);

    // With both caches expired, we synchronously re-fetch and return revoked access.
    expect(await getSessionIfExists(context, sessionId)).toEqual(null);
    expect(getCount()).toEqual(2);

    expect(await getSessionIfExists(context, sessionId)).toEqual(null);
    expect(getCount()).toEqual(2);
});

test("transient errors do not poison the cache", async () => {
    const {accountId, sessionId} = await createSessionForGetSessionTest();
    const getItemIfExists = AccountsTable.getItemIfExists.bind(AccountsTable);
    let shouldThrow = true;

    const getItemIfExistsSpy = import.meta.jest
        .spyOn(AccountsTable, "getItemIfExists")
        .mockImplementation(async (...args) => {
            if (shouldThrow) {
                shouldThrow = false;
                throw new InternalError("Transient session lookup error");
            }

            return getItemIfExists(...args);
        });

    try {
        await expect(getSessionIfExists(context, sessionId)).rejects.toThrow(
            "Transient session lookup error",
        );

        // A failed lookup should not be cached. The next call should re-fetch and succeed.
        await expect(getSessionIfExists(context, sessionId)).resolves.toEqual(accountId);

        expect(getItemIfExistsSpy).toHaveBeenCalledTimes(2);
    } finally {
        getItemIfExistsSpy.mockRestore();
    }
});
