import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {ChannelRealtimeDurableObject} from "~/server/forum/realtime/channel_realtime_durable_object.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";

const context = createTestWorkerContext();
const {connectForTest} = ChannelRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a channel that does not exist", async () => {
    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a channel in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(connectForTest(context.action(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing post durable object in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    await connectForTest(context.action(session), channel.id);

    await expect(connectForTest(context.action(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});
