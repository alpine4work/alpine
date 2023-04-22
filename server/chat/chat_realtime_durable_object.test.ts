import {ChatRealtimeDurableObject} from "~/server/chat/chat_realtime_durable_object";
import {getOrCreateChatForAccounts} from "~/server/dynamo/chat_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
const {connectForTest} = ChatRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a chat that does not exist", async () => {
    await expect(connectForTest(context.action(session1), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a chat in a different space", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await expect(connectForTest(context.action(otherSession), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing chat durable object in a different space", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await connectForTest(context.action(session1), chatId);

    await expect(connectForTest(context.action(otherSession), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to a chat as an account without access", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await expect(connectForTest(context.action(session3), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing chat durable object as an account without access", async () => {
    const chatId = await getOrCreateChatForAccounts(context.action(session1), {
        spaceId: space.id,
        otherAccountIds: [session2.accountId],
    });

    await connectForTest(context.action(session1), chatId);

    await expect(connectForTest(context.action(session3), chatId)).rejects.toThrow(
        PermissionDeniedError,
    );
});
