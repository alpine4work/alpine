import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {getPossiblyStaleAccountSearchAffinityEntityIds} from "~/server/search/data/table/search_entity_actions.js";
import {getSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({searchInjection});

function generateOrganizationEmailAddress(emailDomain: string) {
    return `test.${generateId()}@${emailDomain}`;
}

function generateOrganizationEmailDomain() {
    return `company-${generateId()}.com`;
}

async function createSpaceWithOrganizationDomain(
    emailDomain: string,
    {isEnabled = true}: {isEnabled?: boolean} = {},
) {
    const space = await TestSpace.create(context);

    await DynamoTableSchema.executeTransaction(context, [
        SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "AutoAddAccountsFromEmailDomain",
            spaceId: space.id,
            emailDomain,
        }),
        SpacesTable.transactionCreateItem({
            partitionType: "AutoAddAccountsFromEmailDomain",
            sortRangeType: "Space",
            emailDomain,
            spaceId: space.id,
            isEnabled,
        }),
    ]);

    return space;
}

async function getAllSpaceAccountIds(session: TestSpaceSession) {
    const accounts = await expensivelyGetAllSpaceAccounts(session.action(), session.space.id, {
        // Skip the cache.
        consistency: "Strong",
    });

    return accounts.map(account => account.id).sort();
}

async function getAccountAffinityPointsById(session: TestSpaceSession) {
    return new Map(
        Array.from(
            await getPossiblyStaleAccountSearchAffinityEntityIds(
                context.action(session),
                session.space.id,
            ),
            ({id, points}) => [id, points],
        ),
    );
}

test("can not invite accounts for a space we are not in", async () => {
    const spaceA = await TestSpace.create(context);
    const spaceB = await TestSpace.create(context);
    const sessionA = await spaceA.createSession();
    const sessionB = await spaceB.createSession();

    await expect(
        inviteEmailAddressesToSpace(context.action(sessionA), {
            spaceId: spaceB.id,
            emailAddresses: ["test@test.cyberworlds.dev"],
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        inviteEmailAddressesToSpace(context.action(sessionB), {
            spaceId: spaceA.id,
            emailAddresses: ["test@test.cyberworlds.dev"],
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));
});

test("only owners and admins can invite members", async () => {
    const space = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});
    const {
        accounts: [invitedAccount1],
    } = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: ["test1@test.cyberworlds.dev"],
    });
    assert(invitedAccount1);

    const adminSession = await space.createSession({role: "Admin"});
    const {
        accounts: [invitedAccount2],
    } = await inviteEmailAddressesToSpace(context.action(adminSession), {
        spaceId: space.id,
        emailAddresses: ["test2@test.cyberworlds.dev"],
    });
    assert(invitedAccount2);

    const memberSession = await space.createSession({role: "Member"});

    expect(await getAllSpaceAccountIds(adminSession)).toEqual(
        [
            ownerSession.account.id,
            adminSession.account.id,
            memberSession.account.id,
            invitedAccount1.id,
            invitedAccount2.id,
        ].sort(),
    );

    const memberInviteEmailAddressA = generateEmailAddressForTest();
    const memberInviteEmailAddressB = generateEmailAddressForTest();
    const memberInviteResult = await inviteEmailAddressesToSpace(context.action(memberSession), {
        spaceId: space.id,
        emailAddresses: [memberInviteEmailAddressA, memberInviteEmailAddressB],
    });

    expect(memberInviteResult.accounts.length).toEqual(0);
    expect(memberInviteResult.invalidEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.alreadyMemberEmailAddresses.size).toEqual(0);
    expect([...memberInviteResult.requiresAdminAccessEmailAddresses].sort()).toEqual(
        [memberInviteEmailAddressA, memberInviteEmailAddressB].sort(),
    );
    expect(memberInviteResult.unexpectedFailureEmailAddresses.size).toEqual(0);

    // Make sure we didn't report an error but then silently added the accounts.
    expect(await getAllSpaceAccountIds(adminSession)).toEqual(
        [
            ownerSession.account.id,
            adminSession.account.id,
            memberSession.account.id,
            invitedAccount1.id,
            invitedAccount2.id,
        ].sort(),
    );
});

test("members can invite accounts from enabled auto-add email domains", async () => {
    const emailDomain = generateOrganizationEmailDomain();
    const space = await createSpaceWithOrganizationDomain(emailDomain);
    const memberSession = await space.createSession({role: "Member"});

    expect(await getAllSpaceAccountIds(memberSession)).toEqual([memberSession.account.id].sort());

    const memberInviteEmailAddress = generateOrganizationEmailAddress(emailDomain);
    const memberInviteResult = await inviteEmailAddressesToSpace(context.action(memberSession), {
        spaceId: space.id,
        emailAddresses: [memberInviteEmailAddress],
    });

    expect(memberInviteResult.accounts.length).toEqual(1);
    expect(memberInviteResult.invalidEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.alreadyMemberEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.requiresAdminAccessEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.unexpectedFailureEmailAddresses.size).toEqual(0);

    expect(await getAllSpaceAccountIds(memberSession)).toEqual(
        [memberSession.account.id, memberInviteResult.accounts[0]!.id].sort(),
    );
});

test("members cannot invite accounts from disabled auto-add email domains", async () => {
    const emailDomain = generateOrganizationEmailDomain();
    const space = await createSpaceWithOrganizationDomain(emailDomain, {isEnabled: false});
    const memberSession = await space.createSession({role: "Member"});

    expect(await getAllSpaceAccountIds(memberSession)).toEqual([memberSession.account.id].sort());

    const memberInviteEmailAddressA = generateOrganizationEmailAddress(emailDomain);
    const memberInviteEmailAddressB = generateOrganizationEmailAddress(emailDomain);
    const memberInviteResult = await inviteEmailAddressesToSpace(context.action(memberSession), {
        spaceId: space.id,
        emailAddresses: [memberInviteEmailAddressA, memberInviteEmailAddressB],
    });

    expect(memberInviteResult.accounts.length).toEqual(0);
    expect(memberInviteResult.invalidEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.alreadyMemberEmailAddresses.size).toEqual(0);
    expect([...memberInviteResult.requiresAdminAccessEmailAddresses].sort()).toEqual(
        [memberInviteEmailAddressA, memberInviteEmailAddressB].sort(),
    );
    expect(memberInviteResult.unexpectedFailureEmailAddresses.size).toEqual(0);

    // Make sure we didn't report an error but then silently added the accounts.
    expect(await getAllSpaceAccountIds(memberSession)).toEqual([memberSession.account.id].sort());
});

test("members cannot invite accounts from auto-add domains configured in a different space", async () => {
    const emailDomain = generateOrganizationEmailDomain();
    await createSpaceWithOrganizationDomain(emailDomain, {isEnabled: true});

    const space = await TestSpace.create(context);
    const memberSession = await space.createSession({role: "Member"});

    expect(await getAllSpaceAccountIds(memberSession)).toEqual([memberSession.account.id].sort());

    const memberInviteEmailAddressA = generateOrganizationEmailAddress(emailDomain);
    const memberInviteEmailAddressB = generateOrganizationEmailAddress(emailDomain);
    const memberInviteResult = await inviteEmailAddressesToSpace(context.action(memberSession), {
        spaceId: space.id,
        emailAddresses: [memberInviteEmailAddressA, memberInviteEmailAddressB],
    });

    expect(memberInviteResult.accounts.length).toEqual(0);
    expect(memberInviteResult.invalidEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect(memberInviteResult.alreadyMemberEmailAddresses.size).toEqual(0);
    expect([...memberInviteResult.requiresAdminAccessEmailAddresses].sort()).toEqual(
        [memberInviteEmailAddressA, memberInviteEmailAddressB].sort(),
    );
    expect(memberInviteResult.unexpectedFailureEmailAddresses.size).toEqual(0);

    // Make sure we didn't report an error but then silently added the accounts.
    expect(await getAllSpaceAccountIds(memberSession)).toEqual([memberSession.account.id].sort());
});

test("inviting existing and new accounts adds affinity points for both invited accounts", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const existingAccount = await TestAccount.create(context);
    const existingAccountEmailAddress = await existingAccount.createEmailAddress();
    const newAccountEmailAddress = generateEmailAddressForTest();

    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [existingAccountEmailAddress, newAccountEmailAddress],
    });

    expect(result.accounts.length).toEqual(2);
    expect(result.affinityPoints.length).toEqual(2);
    expect(result.affinityPoints.every(points => points > 0)).toBe(true);

    const existingInvitedAccount = result.accounts.find(
        account => account.id === existingAccount.id,
    );
    expect(existingInvitedAccount).toBeDefined();

    const newInvitedAccount = assertExists(
        result.accounts.find(account => account.id !== existingAccount.id),
    );

    const affinityPointsByAccountId = await getAccountAffinityPointsById(ownerSession);
    expect(assertExists(affinityPointsByAccountId.get(existingAccount.id))).toBeGreaterThan(0);
    expect(assertExists(affinityPointsByAccountId.get(newInvitedAccount.id))).toBeGreaterThan(0);
});

test("inviting an existing member adds affinity points for that member account", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});
    const memberSession = await space.createSession();
    const memberEmailAddress = await memberSession.account.createEmailAddress();

    const affinityPointsByAccountIdBefore = await getAccountAffinityPointsById(ownerSession);
    const memberAffinityPointsBefore =
        affinityPointsByAccountIdBefore.get(memberSession.account.id) ?? 0;

    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [memberEmailAddress],
    });

    expect(result.accounts.length).toEqual(0);
    expect([...result.alreadyMemberEmailAddresses.keys()]).toEqual([memberEmailAddress]);

    const affinityPointsByAccountIdAfter = await getAccountAffinityPointsById(ownerSession);
    expect(
        assertExists(affinityPointsByAccountIdAfter.get(memberSession.account.id)),
    ).toBeGreaterThan(memberAffinityPointsBefore);
});

test("cannot invite existing members", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const member1Session = await space.createSession();
    const member1Email = await member1Session.account.createEmailAddress();

    // Should fail an invite to a member that already exists
    let result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [member1Email],
    });

    expect(result.accounts.length).toEqual(0);
    expect(result.invalidEmailAddresses.size).toEqual(0);
    expect(result.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect([...result.alreadyMemberEmailAddresses.keys()]).toEqual([member1Email]);

    // // Invite a second member, validate it succeeds even though member1 failed
    const member2Email = generateEmailAddressForTest();
    result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [member1Email, member2Email],
    });

    expect(result.accounts.length).toEqual(1);
    expect(result.invalidEmailAddresses.size).toEqual(0);
    expect(result.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect([...result.alreadyMemberEmailAddresses.keys()]).toEqual([member1Email]);

    const member2CreatedAccount = assertExists(result.accounts[0]);
    expect(member2CreatedAccount?.initialData.name).toEqual(member2Email);

    // Try to invite both members again
    result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [member1Email, member2Email],
    });

    expect(result.accounts.length).toEqual(0);
    expect(result.invalidEmailAddresses.size).toEqual(0);
    expect(result.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect([...result.alreadyMemberEmailAddresses.keys()].sort()).toEqual(
        [member1Email, member2Email].sort(),
    );

    const member2 = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        member2CreatedAccount.id,
    );
    expect(member2?.state?.type).toEqual("InvitePending");
});

test("cannot invite InviteRejectedAsSpam Removed state", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const memberEmail = generateEmailAddressForTest();
    const invite = await ownerSession.inviteEmailAddressAndCreateSession(memberEmail);
    await invite.rejectInviteAsSpam();

    // Should fail an invite a member that has rejected as spam
    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [memberEmail],
    });

    expect(result.accounts.length).toEqual(0);
    expect(result.invalidEmailAddresses.size).toEqual(0);
    expect([...result.rejectedAsSpamEmailAddresses]).toEqual([memberEmail]);
    expect(result.alreadyMemberEmailAddresses.size).toEqual(0);
});

test("can invite ActionByAdmin Removed state", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const memberEmail = generateEmailAddressForTest();
    const invite = await ownerSession.inviteEmailAddressAndCreateSession(memberEmail);
    await space.removeAccount(invite.session.account);

    // Try to invite both members again
    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [memberEmail],
    });

    expect(result.accounts.length).toEqual(1);
    expect(result.invalidEmailAddresses.size).toEqual(0);
    expect(result.rejectedAsSpamEmailAddresses.size).toEqual(0);
    expect(result.alreadyMemberEmailAddresses.size).toEqual(0);

    const member1 = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        invite.session.account.id,
    );
    expect(member1?.state?.type).toEqual("InvitePending");
});

test(`kitchen sink invite test`, async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const alreadyMemberSession1 = await space.createSession();
    const alreadyMemberEmail1 = await alreadyMemberSession1.account.createEmailAddress();
    const alreadyMemberSession2 = await space.createSession();
    const alreadyMemberEmail2 = await alreadyMemberSession2.account.createEmailAddress();

    const rejectedAsSpamInviteEmail1 = generateEmailAddressForTest();
    const rejectedAsSpamInvite1 = await ownerSession.inviteEmailAddressAndCreateSession(
        rejectedAsSpamInviteEmail1,
    );
    await rejectedAsSpamInvite1.rejectInviteAsSpam();

    const rejectedAsSpamInviteEmail2 = generateEmailAddressForTest();
    const rejectedAsSpamInvite2 = await ownerSession.inviteEmailAddressAndCreateSession(
        rejectedAsSpamInviteEmail2,
    );
    await rejectedAsSpamInvite2.rejectInviteAsSpam();

    const removedInviteEmail = generateEmailAddressForTest();
    const removedInvite = await ownerSession.inviteEmailAddressAndCreateSession(removedInviteEmail);
    await space.removeAccount(removedInvite.session.account);

    const invalidEmail1 = "invalid-email";
    const invalidEmail2 = "invalid-email-2";

    const emailAddresses = [
        alreadyMemberEmail1,
        alreadyMemberEmail2,
        rejectedAsSpamInviteEmail1,
        rejectedAsSpamInviteEmail2,
        removedInviteEmail,
        invalidEmail1,
        invalidEmail2,
    ];

    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses,
    });

    expect(result.accounts.length).toEqual(1);
    expect([...result.invalidEmailAddresses].sort()).toEqual([invalidEmail1, invalidEmail2].sort());
    expect([...result.rejectedAsSpamEmailAddresses].sort()).toEqual(
        [rejectedAsSpamInviteEmail1, rejectedAsSpamInviteEmail2].sort(),
    );
    expect([...result.alreadyMemberEmailAddresses.keys()].sort()).toEqual(
        [alreadyMemberEmail1, alreadyMemberEmail2].sort(),
    );

    // We can re-invite a removed account, so check it's back to InvitePending
    const removedAccount = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        removedInvite.session.account.id,
    );

    expect(removedAccount?.state?.type).toEqual("InvitePending");
});

describe("rate limiting", () => {
    function generateGenericEmailAddress() {
        return `test.${generateId()}@gmail.com`;
    }

    test("invites to organization domain emails are not rate limited", async () => {
        const emailDomain = generateOrganizationEmailDomain();
        const space = await createSpaceWithOrganizationDomain(emailDomain);
        const ownerSession = await space.createSession({role: "Owner"});

        // Generate 60 organization domain email addresses (more than the rate limit of 50)
        const emailAddresses = createArrayWithLength(60, () =>
            generateOrganizationEmailAddress(emailDomain),
        );

        // Should succeed without hitting rate limit
        const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
            spaceId: space.id,
            emailAddresses,
        });

        expect(result.accounts.length).toEqual(60);
        expect(result.invalidEmailAddresses.size).toEqual(0);
    });

    test("invites to disabled organization domain emails are not rate limited", async () => {
        const emailDomain = generateOrganizationEmailDomain();
        const space = await createSpaceWithOrganizationDomain(emailDomain, {isEnabled: false});
        const ownerSession = await space.createSession({role: "Owner"});

        const emailAddresses = createArrayWithLength(60, () =>
            generateOrganizationEmailAddress(emailDomain),
        );

        const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
            spaceId: space.id,
            emailAddresses,
        });

        expect(result.accounts.length).toEqual(60);
        expect(result.invalidEmailAddresses.size).toEqual(0);
    });

    test("organization domains from a different space do not bypass rate limits", async () => {
        const emailDomain = generateOrganizationEmailDomain();
        await createSpaceWithOrganizationDomain(emailDomain, {isEnabled: true});

        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        const emailAddresses = createArrayWithLength(51, () =>
            generateOrganizationEmailAddress(emailDomain),
        );

        await expect(
            inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("batch of more than 50 generic emails throws rate limit error", async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        // Generate 51 generic email addresses
        const emailAddresses = createArrayWithLength(51, generateGenericEmailAddress);

        await expect(
            inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("cumulative generic email invites exceeding rate limit throws error", async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        // First batch: 30 generic emails (under limit)
        const firstBatch = createArrayWithLength(30, generateGenericEmailAddress);
        const firstResult = await inviteEmailAddressesToSpace(context.action(ownerSession), {
            spaceId: space.id,
            emailAddresses: firstBatch,
        });
        expect(firstResult.accounts.length).toEqual(30);

        // Second batch: 25 generic emails (would exceed limit: 30 + 25 = 55 > 50)
        const secondBatch = createArrayWithLength(25, generateGenericEmailAddress);
        await expect(
            inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses: secondBatch,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("rate limit applies to non-organization emails even if not generic", async () => {
        const organizationDomain = generateOrganizationEmailDomain();
        const space = await createSpaceWithOrganizationDomain(organizationDomain);
        const ownerSession = await space.createSession({role: "Owner"});

        // Generate emails from a different company domain (not generic, but not
        // organization)
        const otherCompanyDomain = generateOrganizationEmailDomain();
        const emailAddresses = createArrayWithLength(51, () =>
            generateOrganizationEmailAddress(otherCompanyDomain),
        );

        await expect(
            inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("mixed batch with organization and generic emails only counts generic against limit", async () => {
        const emailDomain = generateOrganizationEmailDomain();
        const space = await createSpaceWithOrganizationDomain(emailDomain);
        const ownerSession = await space.createSession({role: "Owner"});

        // 40 organization emails + 40 generic emails Only the 40 generic should count
        // against the limit of 50
        const organizationEmails = createArrayWithLength(40, () =>
            generateOrganizationEmailAddress(emailDomain),
        );
        const genericEmails = createArrayWithLength(40, generateGenericEmailAddress);

        const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
            spaceId: space.id,
            emailAddresses: [...organizationEmails, ...genericEmails],
        });

        expect(result.accounts.length).toEqual(80);
    });

    test("rate limit counter decrements correctly", async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        // First batch: exactly 50 generic emails (at limit)
        const firstBatch = createArrayWithLength(50, generateGenericEmailAddress);
        const firstResult = await inviteEmailAddressesToSpace(context.action(ownerSession), {
            spaceId: space.id,
            emailAddresses: firstBatch,
        });
        expect(firstResult.accounts.length).toEqual(50);

        // Any additional generic email should fail
        const oneMoreEmail = [generateGenericEmailAddress()];
        await expect(
            inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses: oneMoreEmail,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("rate limits are per-space", async () => {
        const spaceA = await TestSpace.create(context);
        const spaceB = await TestSpace.create(context);
        const ownerSessionA = await spaceA.createSession({role: "Owner"});
        const ownerSessionB = await spaceB.createSession({role: "Owner"});

        // Use up rate limit in space A
        const emailsForSpaceA = createArrayWithLength(50, generateGenericEmailAddress);
        await inviteEmailAddressesToSpace(context.action(ownerSessionA), {
            spaceId: spaceA.id,
            emailAddresses: emailsForSpaceA,
        });

        // Space B should still have its own rate limit available
        const emailsForSpaceB = createArrayWithLength(50, generateGenericEmailAddress);
        const result = await inviteEmailAddressesToSpace(context.action(ownerSessionB), {
            spaceId: spaceB.id,
            emailAddresses: emailsForSpaceB,
        });

        expect(result.accounts.length).toEqual(50);
    });

    test("rate limits are reset when the window ends", async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        const originalTime = Date.now();
        const originalDateNow = Date.now;

        let currentTime = originalTime;
        Date.now = () => currentTime;

        try {
            // First batch: 30 generic emails (under limit)
            const firstBatch = createArrayWithLength(30, generateGenericEmailAddress);
            const firstResult = await inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses: firstBatch,
            });
            expect(firstResult.accounts.length).toEqual(30);

            currentTime += 50 * 60 * 1000; // 50 minutes

            // Second batch: 25 generic emails (would exceed limit: 30 + 25 = 55 > 50)
            const secondBatch = createArrayWithLength(25, generateGenericEmailAddress);
            await expect(
                inviteEmailAddressesToSpace(context.action(ownerSession), {
                    spaceId: space.id,
                    emailAddresses: secondBatch,
                }),
            ).rejects.toThrow(FailedPreconditionError);

            currentTime += 5 * 60 * 1000; // 5 minutes

            // Second batch fails again at T55
            await expect(
                inviteEmailAddressesToSpace(context.action(ownerSession), {
                    spaceId: space.id,
                    emailAddresses: secondBatch,
                }),
            ).rejects.toThrow(FailedPreconditionError);

            currentTime += 10 * 60 * 1000; // 10 minutes

            // second batch should succeed at T65
            const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
                spaceId: space.id,
                emailAddresses: secondBatch,
            });
            expect(result.accounts.length).toEqual(25);
        } finally {
            Date.now = originalDateNow;
        }
    });

    test("Concurrent batches fail due to condition check error", async () => {
        const space = await TestSpace.create(context);
        const ownerSession = await space.createSession({role: "Owner"});

        const firstBatch = createArrayWithLength(45, generateGenericEmailAddress);
        const secondBatch = createArrayWithLength(45, generateGenericEmailAddress);

        await expect(
            runAllPromises([
                inviteEmailAddressesToSpace(context.action(ownerSession), {
                    spaceId: space.id,
                    emailAddresses: firstBatch,
                }),
                inviteEmailAddressesToSpace(context.action(ownerSession), {
                    spaceId: space.id,
                    emailAddresses: secondBatch,
                }),
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB ConditionalCheckFailedException: The conditional request failed",
            ),
        );
    });
});
