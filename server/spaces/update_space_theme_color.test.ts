import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {updateSpaceThemeColor} from "~/server/spaces/update_space_theme_color.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {internalGetUpdateOurAccountNameTaskTransactionEntries: () => []},
});

describe("updateSpaceThemeColor", () => {
    test("updates theme color as Admin", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const updatedSpace = await updateSpaceThemeColor(session.action(), space.id, "red");

        expect(updatedSpace.themeColor).toEqual("red");
    });

    test("updates theme color as Owner", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Owner"});

        const updatedSpace = await updateSpaceThemeColor(session.action(), space.id, "green");

        expect(updatedSpace.themeColor).toEqual("green");
    });

    test("throws PermissionDeniedError when updating as Member", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Member"});

        await expect(updateSpaceThemeColor(session.action(), space.id, "indigo")).rejects.toThrow(
            PermissionDeniedError,
        );
    });

    test("persists theme color to database", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        await updateSpaceThemeColor(session.action(), space.id, "purple");

        const fetchedSpace = await getSpace(session.action(), space.id);
        expect(fetchedSpace.themeColor).toEqual("purple");
    });

    test("returns SpaceModel with correct id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const updatedSpace = await updateSpaceThemeColor(session.action(), space.id, "orange");

        expect(updatedSpace.id).toEqual(space.id);
    });

    test("throws when Admin from another space tries to update", async () => {
        const space = await TestSpace.create(context);
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession({role: "Admin"});

        await expect(
            updateSpaceThemeColor(otherSession.action(), space.id, "cyan"),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
