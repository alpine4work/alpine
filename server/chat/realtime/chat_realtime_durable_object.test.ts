import {getOrCreateChatForAccounts} from "~/server/chat/data/chat_table.js";
import {ChatRealtimeDurableObject} from "~/server/chat/realtime/chat_realtime_durable_object.js";
import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestWorkerContext();
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
