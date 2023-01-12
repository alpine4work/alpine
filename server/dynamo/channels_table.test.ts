import {createChannel, getChannel} from "~/server/dynamo/channels_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not create a channel for a different space", async () => {
    await expect(
        createChannel(context.request(session), {
            spaceId: otherSpace.id,
            name: "Test",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can create a channel", async () => {
    await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });
});

test("can not get a channel that does not exist", async () => {
    expect(await getChannel(context.request(otherSession), generateId())).toEqual(null);
});

test("can not get a channel for a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(getChannel(context.request(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a channel", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    expect((await getChannel(context.request(session), channel.id))?.name).toEqual("Test");
});
