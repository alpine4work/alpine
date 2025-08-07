import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpaceAccountForTest} from "~/server/spaces/spaces_table.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/with_search/invite_email_addresses_to_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const context = createTestContext();

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
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have `Admin` access to space"));

    await expect(
        inviteEmailAddressesToSpace(context.action(sessionB), {
            spaceId: spaceA.id,
            emailAddresses: ["test@test.cyberworlds.dev"],
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have `Admin` access to space"));
});

test("only owners and admins can invite members", async () => {
    const space = await TestSpace.create(context);

    const ownerSession = await space.createSession({role: "Owner"});
    await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: ["test1@test.cyberworlds.dev"],
    });

    const adminSession = await space.createSession({role: "Admin"});
    await inviteEmailAddressesToSpace(context.action(adminSession), {
        spaceId: space.id,
        emailAddresses: ["test2@test.cyberworlds.dev"],
    });

    const memberSession = await space.createSession();
    await expect(
        inviteEmailAddressesToSpace(context.action(memberSession), {
            spaceId: space.id,
            emailAddresses: ["test3@test.cyberworlds.dev"],
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have `Admin` access to space"));
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

    expect(result.accounts).toHaveLength(0);
    expect(result.invalidEmailAddresses).toHaveLength(0);
    expect(result.rejectedAsSpamEmailAddresses).toHaveLength(0);
    expect(result.alreadyMemberEmailAddresses).toEqual([member1Email]);

    // // Invite a second member, validate it succeeds even though member1 failed
    const member2Email = generateEmailAddressForTest();
    result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [member1Email, member2Email],
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.invalidEmailAddresses).toHaveLength(0);
    expect(result.rejectedAsSpamEmailAddresses).toHaveLength(0);
    expect(result.alreadyMemberEmailAddresses).toEqual([member1Email]);

    const member2CreatedAccount = assertExists(result.accounts[0]);
    expect(member2CreatedAccount?.initialData.name).toEqual(member2Email);

    // Try to invite both members again
    result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [member1Email, member2Email],
    });

    expect(result.accounts).toHaveLength(0);
    expect(result.invalidEmailAddresses).toHaveLength(0);
    expect(result.rejectedAsSpamEmailAddresses).toHaveLength(0);
    expect(result.alreadyMemberEmailAddresses).toEqual([member1Email, member2Email]);

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
    const invite = await space.inviteEmailAddressAndCreateSession(
        context.action(ownerSession),
        memberEmail,
    );
    await invite.rejectInviteAsSpam();

    // Should fail an invite a member that has rejected as spam
    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [memberEmail],
    });

    expect(result.accounts).toHaveLength(0);
    expect(result.invalidEmailAddresses).toHaveLength(0);
    expect(result.rejectedAsSpamEmailAddresses).toEqual([memberEmail]);
    expect(result.alreadyMemberEmailAddresses).toHaveLength(0);
});

test("can invite ActionByAdmin Removed state", async () => {
    const space = await TestSpace.create(context);
    const ownerSession = await space.createSession({role: "Owner"});

    const memberEmail = generateEmailAddressForTest();
    const invite = await space.inviteEmailAddressAndCreateSession(
        context.action(ownerSession),
        memberEmail,
    );
    await space.removeAccount(invite.session.account);

    // Try to invite both members again
    const result = await inviteEmailAddressesToSpace(context.action(ownerSession), {
        spaceId: space.id,
        emailAddresses: [memberEmail],
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.invalidEmailAddresses).toHaveLength(0);
    expect(result.rejectedAsSpamEmailAddresses).toHaveLength(0);
    expect(result.alreadyMemberEmailAddresses).toHaveLength(0);

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
    const rejectedAsSpamInvite1 = await space.inviteEmailAddressAndCreateSession(
        context.action(ownerSession),
        rejectedAsSpamInviteEmail1,
    );
    await rejectedAsSpamInvite1.rejectInviteAsSpam();

    const rejectedAsSpamInviteEmail2 = generateEmailAddressForTest();
    const rejectedAsSpamInvite2 = await space.inviteEmailAddressAndCreateSession(
        context.action(ownerSession),
        rejectedAsSpamInviteEmail2,
    );
    await rejectedAsSpamInvite2.rejectInviteAsSpam();

    const removedInviteEmail = generateEmailAddressForTest();
    const removedInvite = await space.inviteEmailAddressAndCreateSession(
        context.action(ownerSession),
        removedInviteEmail,
    );
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

    expect(result.accounts).toHaveLength(1);
    expect(result.invalidEmailAddresses).toEqual([invalidEmail1, invalidEmail2]);
    expect(result.rejectedAsSpamEmailAddresses).toEqual([
        rejectedAsSpamInviteEmail1,
        rejectedAsSpamInviteEmail2,
    ]);
    expect(result.alreadyMemberEmailAddresses).toEqual([alreadyMemberEmail1, alreadyMemberEmail2]);

    // We can re-invite a removed account, so check it's back to InvitePending
    const removedAccount = await getSpaceAccountForTest(
        context.systemAction(space.id),
        space.id,
        removedInvite.session.account.id,
    );

    expect(removedAccount?.state?.type).toEqual("InvitePending");
});
