import {createChannel, createPost} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {PostRealtimeDurableObject} from "~/server/posts/post_realtime_durable_object";
import {emptyPostContent} from "~/shared/content/post_content_schema";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
const {connectForTest} = PostRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a post that does not exist", async () => {
    await expect(connectForTest(context.request(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a post in a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await expect(connectForTest(context.request(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing post durable object in a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await connectForTest(context.request(session), post.id);

    await expect(connectForTest(context.request(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});
