import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getMessageDraftFiles} from "~/server/messaging/drafts/get_message_draft_files.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const context = createTestContext({spacesInjection});

describe("getMessageDraftFiles()", () => {
    test("returns empty files when no file ids are provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        expect(
            await getMessageDraftFiles(session.action(), {
                spaceId: space.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
                fileIds: emptyArray,
            }),
        ).toEqual([]);
    });

    test("throws if actor does not have access to the space", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const session = await space.createSession();

        await expect(
            getMessageDraftFiles(session.action(), {
                spaceId: otherSpace.id,
                surface: {type: "Chat", chatId: generateId<ChatId>()},
                fileIds: emptyArray,
            }),
        ).rejects.toThrow("Account doesn\u2019t have access to space");
    });
});
