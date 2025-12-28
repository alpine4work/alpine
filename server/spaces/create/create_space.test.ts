import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {expensivelyGetChannelsInSpaceForTest} from "~/server/forum/data/expensively_get_channels_in_space_for_test.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {createSpace, createSpaceForAccountAsAdmin} from "~/server/spaces/create/create_space.js";
import {getOurAccountSpaceIds} from "~/server/spaces/get_our_account_space_ids.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

const dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization = import.meta.jest.fn(
    searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.bind(null),
);

const context = createTestContext({
    forumInjection,
    spacesInjection,
    searchInjection: {
        ...searchInjection,
        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization,
    },
});

describe("createSpaceForAccountAsAdmin()", () => {
    describe("successful space creation", () => {
        test("creates space with owner as member", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});
            const spaceName = "Test Space";

            const space = await createSpaceForAccountAsAdmin(session.action(), {
                name: spaceName,
                ownerAccountId: session.account.id,
            });

            const spaceAccount = await getSpaceAccountItemIfExists(
                session.action(),
                space.id,
                session.account.id,
            );

            expect(spaceAccount).toBeDefined();
            expect(spaceAccount!.role).toBe("Owner");
        });

        test("creates space and adds to our account IDs", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});
            const spaceName = "Test Space";

            const space = await createSpaceForAccountAsAdmin(session.action(), {
                name: spaceName,
                ownerAccountId: session.account.id,
            });

            const {spaceIds} = await getOurAccountSpaceIds(session.action());
            expect(spaceIds.size).toBe(2); // Existing space + new space
            expect(spaceIds.has(space.id)).toBe(true);
        });

        test("creates space with unique generated ID", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});

            const space1 = await createSpaceForAccountAsAdmin(session.action(), {
                name: "Space 1",
                ownerAccountId: session.account.id,
            });
            const space2 = await createSpaceForAccountAsAdmin(session.action(), {
                name: "Space 2",
                ownerAccountId: session.account.id,
            });

            expect(space1.id).not.toBe(space2.id);
            expect(space1.id).not.toBe(existingSpace.id);
            expect(space2.id).not.toBe(existingSpace.id);
        });

        test("creates General channel in the new space", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});

            const space = await createSpaceForAccountAsAdmin(session.action(), {
                name: "Test Space",
                ownerAccountId: session.account.id,
            });

            // Get the channels in the new space and verify General channel exists
            const channels = await expensivelyGetChannelsInSpaceForTest(session.action(), space.id);

            expect(channels).toBeDefined();
            expect(channels?.length).toBeGreaterThan(0);

            // Find the General channel
            const generalChannel = channels?.find(channel => channel.name === "General");
            expect(generalChannel).toBeDefined();
            expect(generalChannel?.name).toBe("General");
            expect(generalChannel?.spaceId).toBe(space.id);
        });

        test("assigns affinity points to Welcome channel for user", async () => {
            // Testing search in this package would be a bit of work, instead
            // lets just verify that the function to add affinity points is called
            // NOTE: this function only creates the transaction entries, it doesn't actually
            // execute them, so we aren't _truly_ testing search integration here.
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});

            const space = await createSpaceForAccountAsAdmin(session.action(), {
                name: "Test Space",
                ownerAccountId: session.account.id,
            });

            const channels = await expensivelyGetChannelsInSpaceForTest(session.action(), space.id);
            const generalChannel = channels?.find(channel => channel.name === "General");

            // get the second argument of the first call
            const affinityCall =
                dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mock.calls[0]![1];

            expect(affinityCall).toEqual({
                spaceId: space.id,
                accountId: session.account.id,
                entityId: `Channel:${generalChannel!.id}`,
                points: 2.999,
            });
        });
    });

    describe("space name validation", () => {
        const spaceNameTestCases: Array<[string, string, string?]> = [
            ["simple name", "My Space"],
            ["name with numbers", "Space 123"],
            ["name with special characters", "Team-Alpha_Beta"],
            ["single character", "A"],
            ["name at max length", "A".repeat(50)],
            ["multibyte character", "😍"],
            ["name with leading/trailing spaces", "  My Space  ", "My Space"],
            ["name with multiple internal spaces", "My    Space", "My Space"],
            ["name with tabs and newlines", "My\tSpace\nName", "My Space Name"],
            ["name with mixed whitespace", "  My \t Space \n Name  ", "My Space Name"],
        ] as const;

        spaceNameTestCases.forEach(([description, spaceName, givenExpectedName]) => {
            test(`accepts ${description}`, async () => {
                const existingSpace = await TestSpace.create(context);
                const session = await existingSpace.createSession({hasInternalAccess: true});

                const expectedName = givenExpectedName || spaceName;
                const space = await createSpaceForAccountAsAdmin(session.action(), {
                    name: spaceName,
                    ownerAccountId: session.account.id,
                });
                expect(space.name).toBe(expectedName);
            });
        });

        test("rejects name longer than 50 characters", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});
            const longName = "A".repeat(51);

            await expect(
                createSpaceForAccountAsAdmin(session.action(), {
                    name: longName,
                    ownerAccountId: session.account.id,
                }),
            ).rejects.toThrow(
                new InvalidArgumentError("Space name cannot be more than 50 characters"),
            );
        });
    });

    describe("multiple spaces per account", () => {
        test("allows account to create multiple spaces", async () => {
            const existingSpace = await TestSpace.create(context);
            const session = await existingSpace.createSession({hasInternalAccess: true});

            await createSpaceForAccountAsAdmin(session.action(), {
                name: "First Space",
                ownerAccountId: session.account.id,
            });
            await createSpaceForAccountAsAdmin(session.action(), {
                name: "Second Space",
                ownerAccountId: session.account.id,
            });
            await createSpaceForAccountAsAdmin(session.action(), {
                name: "Third Space",
                ownerAccountId: session.account.id,
            });

            const {spaceIds} = await getOurAccountSpaceIds(session.action());
            expect(spaceIds.size).toBe(4); // Existing space + 3 new spaces
        });

        test("maintains separate ownership for different accounts", async () => {
            const space1 = await TestSpace.create(context);
            const space2 = await TestSpace.create(context);
            const session1 = await space1.createSession({hasInternalAccess: true});
            const session2 = await space2.createSession({hasInternalAccess: true});

            await createSpaceForAccountAsAdmin(session1.action(), {
                name: "Session 1 Space",
                ownerAccountId: session1.account.id,
            });
            await createSpaceForAccountAsAdmin(session2.action(), {
                name: "Session 2 Space",
                ownerAccountId: session2.account.id,
            });

            const {spaceIds: spaceIds1} = await getOurAccountSpaceIds(session1.action());
            const {spaceIds: spaceIds2} = await getOurAccountSpaceIds(session2.action());

            expect(spaceIds1.size).toBe(2); // Original space + new space
            expect(spaceIds2.size).toBe(2); // Original space + new space

            // Verify each account owns different spaces
            const intersection = new Set([...spaceIds1].filter(id => spaceIds2.has(id)));
            expect(intersection.size).toBe(0);
        });
    });

    describe("admin role detection", () => {
        test("allows account with admin role to create new space", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin", hasInternalAccess: true});

            await createSpaceForAccountAsAdmin(session.action(), {
                name: "New Space",
                ownerAccountId: session.account.id,
            });

            const {spaceIds} = await getOurAccountSpaceIds(session.action());
            expect(spaceIds.size).toBe(2); // Original space + new space
        });

        test("allows account with no existing admin roles to create space", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Member", hasInternalAccess: true});

            await createSpaceForAccountAsAdmin(session.action(), {
                name: "New Space",
                ownerAccountId: session.account.id,
            });

            const {spaceIds} = await getOurAccountSpaceIds(session.action());
            expect(spaceIds.size).toBe(2); // Original space + new space
        });
    });
});

describe("createSpaceForCurrentAccount()", () => {
    test("creates space for current account", async () => {
        const existingSpace = await TestSpace.create(context);
        const session = await existingSpace.createSession();
        const spaceName = "Current Account Space";

        const space = await createSpace(session.action(), {
            name: spaceName,
        });

        expect(space.name).toBe(spaceName);

        const spaceAccount = await getSpaceAccountItemIfExists(
            session.action(),
            space.id,
            session.account.id,
        );
        expect(spaceAccount).toBeDefined();
        expect(spaceAccount!.role).toBe("Owner");

        const {spaceIds} = await getOurAccountSpaceIds(session.action());
        expect(spaceIds.size).toBe(2); // Existing space + new space
        expect(spaceIds.has(space.id)).toBe(true);
    });
});
