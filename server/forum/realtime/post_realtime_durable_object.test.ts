import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel, createPost} from "~/server/forum/data/forum_table.js";
import {PostRealtimeDurableObject} from "~/server/forum/realtime/post_realtime_durable_object.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {emptyPostContent} from "~/shared/forum/post_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestWorkerContext();
const {connectForTest} = PostRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a post that does not exist", async () => {
    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a post in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await expect(connectForTest(context.action(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing post durable object in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await connectForTest(context.action(session), post.id);

    await expect(connectForTest(context.action(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});
