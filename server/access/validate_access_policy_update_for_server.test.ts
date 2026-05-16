import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {SitesInjection} from "~/server/context/injection_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicy, LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SiteId, SiteSideBarId, SpaceId} from "~/shared/id/types/id_types.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

// Mutable map that tests can configure for site access policies
const siteAccessPolicies = new Map<SiteId, LocalAccessPolicy>();

const testSitePosition = {
    parentId: `SideBar:${generateId<SiteSideBarId>()}` as const,
    orderKey: assertOrderKey("a0"),
};

// Sentinels returned by the injection mocks. Tests in "site transaction entry
// plumbing" assert against these references to verify that the validator threaded
// the injection's return values back to the caller.
const addSentinel = [
    {transactionEntry: {type: "add-sentinel"}, getEvent: async () => ({})},
] as never;
const removeSentinel = [{transactionEntry: {type: "remove-sentinel"}}] as never;

const sitesInjection: SitesInjection = {
    dangerouslyGetSiteAccessPolicyWithoutAuthorization: async (_context, siteId) => {
        const policy = siteAccessPolicies.get(siteId);
        if (!policy) {
            throw new FailedPreconditionError(`Site ${siteId} not found in test fixture`);
        }
        return policy;
    },
    getSitePreview: async (_context, siteId) => {
        const policy = siteAccessPolicies.get(siteId);
        if (!policy) {
            throw new FailedPreconditionError(`Site ${siteId} not found in test fixture`);
        }
        return new SitePreviewModel({
            id: siteId,
            spaceId: generateId<SpaceId>(),
            name: "Test Site",
            firstEntityId: null,
            createdTime: new Date(),
            accessPolicy: policy,
            version: 1,
            rootContainerId: printSiteContainerId({
                type: "SideBar",
                id: generateId<SiteSideBarId>(),
            }),
            creatorId: generateId<AccountId>(),
        });
    },
    dangerouslyGetAddToSiteTransactionEntries: async () => addSentinel,
    dangerouslyGetRemoveFromSiteTransactionEntries: async () => removeSentinel,
};

const context = createTestContext({
    chatInjection,
    sitesInjection,
});

beforeEach(() => {
    siteAccessPolicies.clear();
});

test("bots cannot update existing access policies", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const oldAccessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const newAccessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: {level: "View"},
        urlGrant: null,
    };

    await expect(
        validateAccessPolicyUpdateForServer(
            botAction,
            space.id,
            `Channel:${generateId<ChannelId>()}`,
            oldAccessPolicy,
            newAccessPolicy,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Bots can’t update access policies"));
});

test("bots can create new access policies", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, botAccount);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const newAccessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    // Should not throw - bots can create new access policies (oldAccessPolicy is null)
    await expect(
        validateAccessPolicyUpdateForServer(
            botAction,
            space.id,
            `Channel:${generateId<ChannelId>()}`,
            null,
            newAccessPolicy,
        ),
    ).resolves.not.toThrow();
});

test("bots can’t create new access policies if they don’t have access to the conversation", async () => {
    const space = await TestSpace.create(context);
    const adminSession = await space.createSession({role: "Admin"});
    const session = await space.createSession();

    const botAccount = await TestBot.createAndInstantiate(adminSession);
    const chat = await TestChat.get(adminSession, session);
    const botAction = botAccount.action({type: "Chat", chatId: chat.id});

    const newAccessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[adminSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(
        validateAccessPolicyUpdateForServer(
            botAction,
            space.id,
            `Channel:${generateId<ChannelId>()}`,
            null,
            newAccessPolicy,
        ),
    ).rejects.toThrow(
        new InvalidArgumentError(
            "Account actor must have `Manage` access level on anything they create",
        ),
    );
});

// =============================================================================
// Site change validation tests
// =============================================================================

describe("add to site", () => {
    test("manager can add entity to site when they are also manager on site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice is owner on entity and owner on site, should succeed
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).resolves.not.toThrow("Actor doesn\u2019t have `Manage` access on old access policy");
    });

    test("non-manager of entity cannot add entity to site where they are the manager", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const bobSession = await space.createSession({id: bob});

        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Bob (gen 1 on entity) tries to add to site where he's gen 0. This would escalate
        // Bob from gen 1 to gen 0, putting him in the senior chain. The senior chain check
        // catches this as an invalid self-escalation.
        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access on new access policy");
    });

    test("manager of entity cannot add entity to site if not manager on site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const carol = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [carol, {level: "Manage", generation: 0}],
                [alice, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice is owner on entity (gen 0) but site has Carol (gen 0) and Alice (gen 1).
        // Adding to site would add Carol at gen 0, which is <= Alice's gen 0. This
        // triggers "Can't set new account grant manage generation..." error.
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow(
            "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        );
    });
});

describe("remove from site", () => {
    test("manager on site can remove entity from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice is owner on site and owner on new local policy
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).resolves.not.toThrow("Actor doesn\u2019t have `Manage` access on old access policy");
    });

    test("non-manager on site cannot remove entity from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const bobSession = await space.createSession({id: bob});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Bob is not a manager on the site (only Alice is), so Bob can't remove the entity
        // from the site. The site access check catches this before generation validation.
        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access on old access policy");
    });

    test("manager can remove another manager at same generation when removing from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [bob, {level: "Manage", generation: 0}],
                [alice, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        // Alice (owner, gen 0) tries to remove Bob (also gen 0) when removing from site
        // Since both are at gen 0, Alice can remove Bob (same generation, not less than)
        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // This should succeed since they're at the same generation
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).resolves.not.toThrow();
    });

    test("adding manager when removing from site requires generation greater than actor", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const dave = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        // Add Dave to the space so he can be granted access
        await space.createSession({id: dave});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        // Alice tries to add Dave with generation 0 (equal to Alice's)
        const newAccessPolicyBad: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [dave, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Should fail - can't add manager at generation <= actor's generation
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicyBad,
            ),
        ).rejects.toThrow(
            "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        );

        // Alice adds Dave with generation 1 (greater than Alice's)
        const newAccessPolicyGood: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [dave, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Should succeed
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicyGood,
            ),
        ).resolves.not.toThrow();
    });
});

describe("change site", () => {
    test("manager on old site can change to new site when if they are a manager on the new site", async () => {
        const siteA = generateId<SiteId>();
        const siteB = generateId<SiteId>();
        const alice = generateId<AccountId>();

        siteAccessPolicies.set(siteA, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });
        siteAccessPolicies.set(siteB, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy = {
            type: "Site",
            siteId: siteA,
        } as const;

        // Alice is owner on both sites
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId: siteB,
                    position: testSitePosition,
                },
            ),
        ).resolves.not.toThrow();
    });

    test("a non-manager on an old site cannot change to a new site", async () => {
        const siteA = generateId<SiteId>();
        const siteB = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        siteAccessPolicies.set(siteA, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });
        siteAccessPolicies.set(siteB, {
            type: "Local",
            accountGrantById: new Map([[bob, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const bobSession = await space.createSession({id: bob});

        const oldAccessPolicy = {
            type: "Site",
            siteId: siteA,
        } as const;

        // Bob is not a manager on siteA (only Alice is), so Bob can't change from siteA to
        // siteB. The site access check catches this before generation validation.
        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId: siteB,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access on old access policy");
    });

    test("manager on old site cannot change to site where not manager", async () => {
        const siteA = generateId<SiteId>();
        const siteB = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const carol = generateId<AccountId>();

        siteAccessPolicies.set(siteA, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });
        siteAccessPolicies.set(siteB, {
            type: "Local",
            accountGrantById: new Map([[carol, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        const oldAccessPolicy = {
            type: "Site",
            siteId: siteA,
        } as const;

        // Alice is a manager on siteA but not on siteB (only Carol is), so Alice can't
        // change to siteB. The site access check catches this.
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId: siteB,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow("Actor doesn\u2019t have `Manage` access on new access policy");
    });
});

describe("validateAccessPolicyUpdate errors with site changes", () => {
    test("can\u2019t change account grant manage generation when adding to site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        // Site has Alice at gen 0, Bob at gen 2
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 2}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});

        // Entity has Alice at gen 0, Bob at gen 1 (different from site)
        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Under the new rules, Alice (gen 0) CAN change Bob's generation since Bob (gen 1)
        // is junior to Alice. When adding to site, Bob's generation changes from 1 to 2,
        // which is allowed because Alice can modify junior managers' generations.
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).resolves.toBeDefined();
    });
});

describe("multiple owners at same generation", () => {
    test("any owner can add entity to site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        const bobSession = await space.createSession({id: bob});

        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Both Alice and Bob can add to site since they're both owners (gen 0)
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).resolves.not.toThrow();

        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).resolves.not.toThrow();
    });
});

// =============================================================================
// Edge case tests for generation validation during site transitions
// =============================================================================

describe("generation validation edge cases", () => {
    test("can\u2019t remove manager accounts at older generation when removing from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        // Site has Alice (gen 0) and Bob (gen 1)
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const bobSession = await space.createSession({id: bob});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        // Bob (gen 1) tries to remove from site and exclude Alice (gen 0)
        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[bob, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Should fail - Bob can't revoke Alice's access (Alice has lower generation)
        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).rejects.toThrow(
            "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        );
    });

    test("can\u2019t add manager at same generation as actor when removing from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const carol = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        // Add Carol to the space so she can be granted access
        await space.createSession({id: carol});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        // Alice (gen 0) tries to remove from site and add Carol at gen 0
        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Should fail - can't add new manager at same generation as actor
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).rejects.toThrow(
            "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        );
    });

    test("can\u2019t add to site if site has manager at lower generation than actor", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const carol = generateId<AccountId>();

        // Alice is owner (gen 0) on entity but not on site
        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [carol, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Site has Carol at gen 0
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [carol, {level: "Manage", generation: 0}],
                [alice, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        await space.createSession({id: carol});

        // Should fail - adding to site would add Carol (gen 0) which is <= Alice's gen 0
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow(
            "Can\u2019t set new account grant manage generation to be less than or equal to our actor\u2019s manage generation",
        );
    });

    test("generation hierarchy preserved when changing between sites", async () => {
        const siteA = generateId<SiteId>();
        const siteB = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        // Site A has Alice (gen 0) and Bob (gen 1)
        siteAccessPolicies.set(siteA, {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        // Site B only has Bob (gen 0)
        siteAccessPolicies.set(siteB, {
            type: "Local",
            accountGrantById: new Map([[bob, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const bobSession = await space.createSession({id: bob});
        await space.createSession({id: alice});

        const oldAccessPolicy = {
            type: "Site",
            siteId: siteA,
        } as const;

        // Bob (gen 1 on siteA) tries to change to siteB which removes Alice (gen 0)
        await expect(
            validateAccessPolicyUpdateForServer(
                bobSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId: siteB,
                    position: testSitePosition,
                },
            ),
        ).rejects.toThrow(
            "Can\u2019t revoke manage access from an account with a manage generation less than our actor",
        );
    });

    test("can add manager at higher generation when removing from site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const dave = generateId<AccountId>();

        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        await space.createSession({id: dave});

        const oldAccessPolicy = {
            type: "Site",
            siteId,
        } as const;

        // Alice adds Dave with generation 1 (higher than Alice's gen 0)
        const newAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [dave, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Should succeed - Dave is at a higher generation than Alice
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                newAccessPolicy,
            ),
        ).resolves.not.toThrow();
    });

    test("senior manager can add to site that introduces junior managers", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const bob = generateId<AccountId>();

        // Site has Alice (gen 0) and Bob (gen 1)
        siteAccessPolicies.set(siteId, {
            type: "Local",
            accountGrantById: new Map([
                [alice, {level: "Manage", generation: 0}],
                [bob, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        });

        const space = await TestSpace.create(context);
        const aliceSession = await space.createSession({id: alice});
        await space.createSession({id: bob});

        // Entity currently only has Alice
        const oldAccessPolicy: AccessPolicy = {
            type: "Local",
            accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };

        // Alice (gen 0) can add to site, which adds Bob (gen 1) - that's OK since Bob's
        // generation is higher than Alice's
        await expect(
            validateAccessPolicyUpdateForServer(
                aliceSession.action(),
                space.id,
                `Channel:${generateId<ChannelId>()}`,
                oldAccessPolicy,
                {
                    type: "Site",
                    siteId,
                    position: testSitePosition,
                },
            ),
        ).resolves.not.toThrow();
    });
});

// =============================================================================
// Site transaction entry plumbing tests
//
// These tests verify that `transactionEntries` is returned (non-null) in the right
// scenarios. The injection mocks return sentinel arrays so we can distinguish
// "entries were requested" from "entries were not requested" (null).
// =============================================================================

describe("site transaction entry plumbing", () => {
    function makeSitePolicy(accountId: AccountId): LocalAccessPolicy {
        return {
            type: "Local",
            accountGrantById: new Map([[accountId, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: null,
        };
    }

    function makeEntityId(): SiteItemSearchEntityId {
        return `Channel:${generateId<ChannelId>()}`;
    }

    function makeParentId() {
        return printSiteContainerId({type: "SideBar", id: generateId<SiteSideBarId>()});
    }

    test("returns transactionEntries when adding entity to a site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        siteAccessPolicies.set(siteId, makeSitePolicy(alice));

        const space = await TestSpace.create(context);
        const session = await space.createSession({id: alice});

        const result = await validateAccessPolicyUpdateForServer(
            session.action(),
            space.id,
            makeEntityId(),
            {
                type: "Local",
                accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
            {
                type: "Site",
                siteId,
                position: {parentId: makeParentId(), orderKey: assertOrderKey("a0")},
            },
        );

        expect(result.transactionEntries).toEqual(addSentinel);
    });

    test("returns transactionEntries when removing entity from a site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        siteAccessPolicies.set(siteId, makeSitePolicy(alice));

        const space = await TestSpace.create(context);
        const session = await space.createSession({id: alice});

        const result = await validateAccessPolicyUpdateForServer(
            session.action(),
            space.id,
            makeEntityId(),
            {type: "Site", siteId},
            {
                type: "Local",
                accountGrantById: new Map([[alice, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        );

        expect(result.transactionEntries).toEqual(removeSentinel);
    });

    test("returns both add and remove entries when moving entity between sites", async () => {
        const oldSiteId = generateId<SiteId>();
        const newSiteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        const sitePolicy = makeSitePolicy(alice);
        siteAccessPolicies.set(oldSiteId, sitePolicy);
        siteAccessPolicies.set(newSiteId, sitePolicy);

        const space = await TestSpace.create(context);
        const session = await space.createSession({id: alice});

        const result = await validateAccessPolicyUpdateForServer(
            session.action(),
            space.id,
            makeEntityId(),
            {type: "Site", siteId: oldSiteId},
            {
                type: "Site",
                siteId: newSiteId,
                position: {parentId: makeParentId(), orderKey: assertOrderKey("a0")},
            },
        );

        expect(result.transactionEntries).toEqual([...addSentinel, ...removeSentinel]);
    });

    test("returns empty entries when staying on the same site", async () => {
        const siteId = generateId<SiteId>();
        const alice = generateId<AccountId>();
        siteAccessPolicies.set(siteId, makeSitePolicy(alice));

        const space = await TestSpace.create(context);
        const session = await space.createSession({id: alice});

        const result = await validateAccessPolicyUpdateForServer(
            session.action(),
            space.id,
            makeEntityId(),
            {type: "Site", siteId},
            {type: "Site", siteId, position: testSitePosition},
        );

        expect(result.transactionEntries).toHaveLength(0);
    });
});
