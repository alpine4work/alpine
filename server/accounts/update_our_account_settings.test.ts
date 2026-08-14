import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {updateOurAccountSettings} from "~/server/accounts/update_our_account_settings.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.open_source.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {RpcCallId, SessionId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {ReactionEmotion} from "~/shared/reactions/reaction.js";
import {defaultTop6ReactionEmotionsInOrder} from "~/shared/reactions/reaction_emotion_affinity.js";

const context = createTestContext({
    notificationsInjection: {
        notifyInboxOfTimeZoneChange: asyncNoop,
    },
});

describe("UpdateLastOpenedSpaceId", () => {
    test("should allow updating the lastOpenedSpaceId for the current session", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();
        await space2.addAccount(session);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space1.id,
        });

        const result1 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result1?.lastOpenedSpaceId).toBe(space1.id);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result2 = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result2?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is not a member of", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        await space2OwnerSession.inviteEmailAddress(email);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("allows updating the lastOpenedSpaceId to a space the session is removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        await space2.addAccount(session);

        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        await updateOurAccountSettings(session.action(), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space2.id,
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.lastOpenedSpaceId).toBe(space2.id);
    });

    test("should create a new account settings item and set the lastOpenedSpaceId if it doesn\u2019t exist", async () => {
        const space1 = await TestSpace.create(context);

        const accountId = generateId<AccountId>();
        await AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
            name: "Test Account",
            nameVersion: 0,
            createdTime: new Date(),
            hasInternalAccess: false,
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
        });

        const initialSettingsItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId,
        });

        expect(initialSettingsItem).toBe(null);

        const sessionId = generateId<SessionId>();
        await createSessionForTest(context, {id: sessionId, accountId});

        await addSpaceAccountForTest(context, {spaceId: space1.id, accountId});

        await updateOurAccountSettings(context.action({id: sessionId, account: {id: accountId}}), {
            type: "UpdateLastOpenedSpaceId",
            spaceId: space1.id,
        });

        const result1 = await AccountsTable.getItemIfExists(
            context.action({id: sessionId, account: {id: accountId}}),
            {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId,
            },
        );
        expect(result1?.lastOpenedSpaceId).toBe(space1.id);
    });
});

describe("UpdateObservedTimeZone", () => {
    test("should allow updating the observedTimeZone for the current session", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const initialItem = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });

        expect(initialItem?.observedTimeZone).toBe(defaultTimeZone);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateObservedTimeZone",
            timeZone: assertTimeZone("America/Los_Angeles"),
        });

        const result = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        expect(result?.observedTimeZone).toBe("America/Los_Angeles");
    });

    test("should create a new account settings item and set the observedTimeZone if it doesn\u2019t exist", async () => {
        const space1 = await TestSpace.create(context);

        const accountId = generateId<AccountId>();
        await AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
            name: "Test Account",
            nameVersion: 0,
            createdTime: new Date(),
            hasInternalAccess: false,
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
        });

        const initialSettingsItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId,
        });

        expect(initialSettingsItem).toBe(null);

        const sessionId = generateId<SessionId>();
        await createSessionForTest(context, {id: sessionId, accountId});

        await addSpaceAccountForTest(context, {spaceId: space1.id, accountId});

        await updateOurAccountSettings(context.action({id: sessionId, account: {id: accountId}}), {
            type: "UpdateObservedTimeZone",
            timeZone: assertTimeZone("America/Los_Angeles"),
        });

        const result1 = await AccountsTable.getItemIfExists(
            context.action({id: sessionId, account: {id: accountId}}),
            {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId,
            },
        );
        expect(result1?.observedTimeZone).toBe("America/Los_Angeles");
    });
});

describe("UpdateReactionAffinity", () => {
    async function getReactionAffinity(session: TestSession) {
        const item = await AccountsTable.getItemIfExists(session.action(), {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: session.account.id,
        });
        return item?.reactionAffinity ?? null;
    }

    async function simulateReaction(session: TestSession, emotion: ReactionEmotion) {
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion, character: {type: "Cat", variant: "Yellow"}},
        });
    }

    test("first reaction creates reaction affinity with 1 point for the selected emotion", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Heart");

        const affinity = await getReactionAffinity(session);
        expect(affinity?.affinityByEmotion.get("Heart")?.points).toBe(1);
    });

    test("1 reaction is below the earning threshold; top6 stays at the default", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Heart");

        const affinity = await getReactionAffinity(session);
        expect(affinity?.top6ReactionEmotions).toEqual(defaultTop6ReactionEmotionsInOrder);
    });

    test("2 reactions cross the earning threshold and promote the emotion to top6 index 0", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Heart");
        await simulateReaction(session, "Heart");

        const affinity = await getReactionAffinity(session);
        expect(affinity?.top6ReactionEmotions[0]).toEqual({
            emotion: "Heart",
            isDefault: false,
        });
    });

    test("earning an emotion updates top4, top5, and top6 consistently", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Heart");
        await simulateReaction(session, "Heart");

        const affinity = await getReactionAffinity(session);
        expect({
            top4: affinity?.top4ReactionEmotions[0]?.emotion,
            top5: affinity?.top5ReactionEmotions[0]?.emotion,
            top6: affinity?.top6ReactionEmotions[0]?.emotion,
        }).toEqual({top4: "Heart", top5: "Heart", top6: "Heart"});
    });

    test("repeated reactions for the same emotion accumulate points", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Laugh");
        await simulateReaction(session, "Laugh");
        await simulateReaction(session, "Laugh");

        const affinity = await getReactionAffinity(session);
        // 3 reactions within seconds of each other \u2014 time-based decay is negligible.
        expect(affinity?.affinityByEmotion.get("Laugh")?.points).toBeGreaterThan(2.5);
    });

    test("two earned emotions occupy top6 slots 0 and 1 in earn order", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await simulateReaction(session, "Heart");
        await simulateReaction(session, "Heart");
        await simulateReaction(session, "ThankYou");
        await simulateReaction(session, "ThankYou");

        const affinity = await getReactionAffinity(session);
        expect(affinity?.top6ReactionEmotions.slice(0, 2)).toEqual([
            {emotion: "Heart", isDefault: false},
            {emotion: "ThankYou", isDefault: false},
        ]);
    });

    test("affinity data is isolated between accounts", async () => {
        const account1 = await TestAccount.create(context);
        const session1 = await TestSession.create(account1);
        const account2 = await TestAccount.create(context);
        const session2 = await TestSession.create(account2);

        await simulateReaction(session1, "Heart");
        await simulateReaction(session2, "No");

        const affinity1 = await getReactionAffinity(session1);
        const affinity2 = await getReactionAffinity(session2);
        expect({
            session1Heart: affinity1?.affinityByEmotion.get("Heart")?.points,
            session1HasNo: affinity1?.affinityByEmotion.has("No"),
            session2No: affinity2?.affinityByEmotion.get("No")?.points,
            session2HasHeart: affinity2?.affinityByEmotion.has("Heart"),
        }).toEqual({
            session1Heart: 1,
            session1HasNo: false,
            session2No: 1,
            session2HasHeart: false,
        });
    });

    test("idempotency error is ignored", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const clientRequestToken = generateId<RpcCallId>();
        const action = {
            type: "UpdateReactionAffinity" as const,
            reaction: {
                emotion: "Heart" as const,
                character: {type: "Cat" as const, variant: "Yellow" as const},
            },
        };

        // Technically, this test can be exercised with the same action, because the
        // affinity points for that emotion would be different in the second call (+1
        // point). For readability, I decided to use a second action to make the test
        // easier to understand.
        const action2 = {
            type: "UpdateReactionAffinity" as const,
            reaction: {
                emotion: "Happy" as const,
                character: {type: "Cat" as const, variant: "Yellow" as const},
            },
        };

        await updateOurAccountSettings(session.action(), action, {clientRequestToken});

        const affinity1 = await getReactionAffinity(session);
        expect(affinity1?.affinityByEmotion).toEqual(
            new Map([["Heart", {points: 1, lastUpdatedTime: expect.any(Number)}]]),
        );

        // A second call with the same idempotency key but the stored state now differs
        // from what the first call started with, so DynamoDB rejects the transaction.
        await updateOurAccountSettings(session.action(), action2, {clientRequestToken});

        const affinity2 = await getReactionAffinity(session);
        expect(affinity2?.affinityByEmotion).toEqual(
            new Map([["Heart", {points: 1, lastUpdatedTime: expect.any(Number)}]]),
        );
    });

    test("an idempotency-rejected second call does not double-count the reaction", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const clientRequestToken = generateId<RpcCallId>();
        const action = {
            type: "UpdateReactionAffinity" as const,
            reaction: {
                emotion: "Heart" as const,
                character: {type: "Cat" as const, variant: "Yellow" as const},
            },
        };

        await updateOurAccountSettings(session.action(), action, {clientRequestToken});

        const affinity1 = await getReactionAffinity(session);
        expect(affinity1?.affinityByEmotion).toEqual(
            new Map([["Heart", {points: 1, lastUpdatedTime: expect.any(Number)}]]),
        );

        // A second call with the same idempotency key but the stored state now differs
        // from what the first call started with, so DynamoDB rejects the transaction.
        await updateOurAccountSettings(session.action(), action, {clientRequestToken});

        const affinity2 = await getReactionAffinity(session);
        expect(affinity2?.affinityByEmotion).toEqual(
            new Map([["Heart", {points: 1, lastUpdatedTime: expect.any(Number)}]]),
        );
    });

    test("different idempotency keys both apply", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        const action = {
            type: "UpdateReactionAffinity" as const,
            reaction: {
                emotion: "Heart" as const,
                character: {type: "Cat" as const, variant: "Yellow" as const},
            },
        };

        await updateOurAccountSettings(session.action(), action, {
            clientRequestToken: generateId<RpcCallId>(),
        });
        await updateOurAccountSettings(session.action(), action, {
            clientRequestToken: generateId<RpcCallId>(),
        });

        const affinity = await getReactionAffinity(session);
        expect(affinity?.affinityByEmotion.get("Heart")?.points).toBeGreaterThan(1);
    });

    test("reaction character is ignored; only emotion affects affinity", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Cat", variant: "Yellow"}},
        });
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Frog", variant: "Green"}},
        });
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Yeti", variant: "Blue"}},
        });

        const affinity = await getReactionAffinity(session);
        expect(affinity?.affinityByEmotion.size).toBe(1);
    });

    test("three reactions on Laugh with varying characters accumulate to a single Laugh entry", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);

        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Cat", variant: "Yellow"}},
        });
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Frog", variant: "Green"}},
        });
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character: {type: "Yeti", variant: "Blue"}},
        });

        const affinity = await getReactionAffinity(session);
        expect(affinity?.affinityByEmotion.get("Laugh")?.points).toBeGreaterThan(2.5);
    });

    test("same character with different emotions produces separate affinity entries", async () => {
        const account = await TestAccount.create(context);
        const session = await TestSession.create(account);
        const character = {type: "Cat" as const, variant: "Yellow" as const};

        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Laugh", character},
        });
        await updateOurAccountSettings(session.action(), {
            type: "UpdateReactionAffinity",
            reaction: {emotion: "Heart", character},
        });

        const affinity = await getReactionAffinity(session);
        expect({
            size: affinity?.affinityByEmotion.size,
            hasLaugh: affinity?.affinityByEmotion.has("Laugh"),
            hasHeart: affinity?.affinityByEmotion.has("Heart"),
        }).toEqual({size: 2, hasLaugh: true, hasHeart: true});
    });
});
