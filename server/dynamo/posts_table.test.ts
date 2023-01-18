import {createChannel} from "~/server/dynamo/channels_table";
import {createPost, getPost} from "~/server/dynamo/posts_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/content/post_content_schema";
import {PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

const testContent = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test")])]),
);

test("can not create a post for a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        createPost(context.request(otherSession), {
            channelId: channel.id,
            content: testContent,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can create a post", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });
});

test("can not get a post that does not exist", async () => {
    expect(await getPost(context.request(session), generateId())).toEqual(null);
});

test("can not get a post for a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(getPost(context.request(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a post", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });

    expect((await getPost(context.request(session), post.id))?.content.toJSON()).toEqual(
        testContent.toJSON(),
    );
});
