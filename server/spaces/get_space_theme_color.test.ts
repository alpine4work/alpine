import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpaceThemeColor} from "~/server/spaces/get_space_theme_color.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {updateSpaceThemeColor} from "~/server/spaces/update_space_theme_color.js";
import {NotFoundError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

describe("getSpaceThemeColor", () => {
    test("returns default theme color for new space", async () => {
        const space = await TestSpace.create(context);

        const themeColor = await getSpaceThemeColor(context, space.id);

        expect(themeColor).toEqual("indigo");
    });

    test("returns updated theme color after change", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await updateSpaceThemeColor(session.action(), space.id, "red");

        const themeColor = await getSpaceThemeColor(context, space.id);

        expect(themeColor).toEqual("red");
    });

    test("throws NotFoundError for non-existent space", async () => {
        const nonExistentSpaceId = generateId<SpaceId>();

        await expect(getSpaceThemeColor(context, nonExistentSpaceId)).rejects.toThrow(
            NotFoundError,
        );
    });
});
