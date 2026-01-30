import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";

const {context, services} = createTestServices();

async function inviteEmailAddressesAndGetResults(
    page: Page,
    {emailAddresses, expectErrors}: {emailAddresses: Array<string>; expectErrors: boolean},
) {
    const inviteButton = page.getByRole("button", {name: "Invite", exact: true});
    await inviteButton.click();

    const emailInput = page.getByRole("textbox", {name: "Emails"});
    await emailInput.fill(emailAddresses.join(", "));

    const sendButton = page.getByRole("button", {name: "Send"});
    await sendButton.click();

    const errors = {
        unexpectedFailure: [] as Array<string>,
        invalid: [] as Array<string>,
        rejectedPreviousInvite: [] as Array<string>,
        alreadyMember: [] as Array<string>,
    };

    if (expectErrors) {
        const errorLocator = page.getByTestId("InviteErroredEmailAddresses");
        const errorText = await errorLocator.textContent();

        const errorTextSentences = errorText?.split(". ");

        const unexpectedFailuresRegex = /(?:^|\. )(.+?) (failed due to an unexpected error)\b/g;
        const unexpectedMatches = errorTextSentences?.flatMap(sentence =>
            Array.from(sentence.matchAll(unexpectedFailuresRegex)),
        );
        if (unexpectedMatches) {
            for (const match of unexpectedMatches) {
                if (match[1]) {
                    const [firstPart, secondPart] = match[1].split("and");
                    const addresses = firstPart?.split(",") ?? [];
                    for (const address of addresses) {
                        errors.unexpectedFailure.push(address.trim());
                    }
                    if (secondPart) {
                        errors.unexpectedFailure.push(secondPart.trim());
                    }
                }
            }
        }

        const invalidRegex =
            /(?:^|\. )(.+?) (?:aren\u2019t valid email addresses|isn\u2019t a valid email address)\b/g;
        const invalidMatches = errorTextSentences?.flatMap(sentence =>
            Array.from(sentence.matchAll(invalidRegex)),
        );
        if (invalidMatches) {
            for (const match of invalidMatches) {
                if (match[1]) {
                    const [firstPart, secondPart] = match[1].split("and");
                    const addresses = firstPart?.split(",") ?? [];
                    for (const address of addresses) {
                        errors.invalid.push(address.trim());
                    }
                    if (secondPart) {
                        errors.invalid.push(secondPart.trim());
                    }
                }
            }
        }

        const rejectedPreviousInviteRegex = /(?:^|\. )(.+?) (rejected a previous invite)\b/g;
        const rejectedPreviousInviteMatches = errorTextSentences?.flatMap(sentence =>
            Array.from(sentence.matchAll(rejectedPreviousInviteRegex)),
        );
        if (rejectedPreviousInviteMatches) {
            for (const match of rejectedPreviousInviteMatches) {
                if (match[1]) {
                    const [firstPart, secondPart] = match[1].split("and");
                    const addresses = firstPart?.split(",") ?? [];
                    for (const address of addresses) {
                        errors.rejectedPreviousInvite.push(address.trim());
                    }
                    if (secondPart) {
                        errors.rejectedPreviousInvite.push(secondPart.trim());
                    }
                }
            }
        }

        const alreadyMemberRegex = /(?:^|\. )(.+?) (?:is already a member|are already members)\b/g;
        const alreadyMemberMatches = errorTextSentences?.flatMap(sentence =>
            Array.from(sentence.matchAll(alreadyMemberRegex)),
        );
        if (alreadyMemberMatches) {
            for (const match of alreadyMemberMatches) {
                if (match[1]) {
                    const [firstPart, secondPart] = match[1].split("and");
                    const addresses = firstPart?.split(",") ?? [];
                    for (const address of addresses) {
                        errors.alreadyMember.push(address.trim());
                    }
                    if (secondPart) {
                        errors.alreadyMember.push(secondPart.trim());
                    }
                }
            }
        }

        const cancelButton = page.getByRole("button", {name: "Cancel"});
        await cancelButton.click();
    }

    // TODO(#fix-remix-revalidate): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/2hrj3rz107gwgw428kvv1yzn4w
    //   Once this bug is fixed, we can remove this sleep
    await new Promise(resolve => setTimeout(resolve, 2500));

    const invitePendingEmailLocators = await page.getByTestId("InviteAccountName").all();
    const invitePendingEmails = (
        await Promise.all(invitePendingEmailLocators.map(el => el.evaluate(el => el.textContent)))
    )
        .filter(isNonNullable)
        .sort();

    return {
        errors,
        invitePendingEmails,
    };
}

test("can invite people and handle email errors", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession({role: "Owner"});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/settings/people`);

    const test1EmailAddress = "test1@test.cyberworlds.dev";

    let result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [test1EmailAddress],
        expectErrors: false,
    });

    expect(result.invitePendingEmails).toEqual([test1EmailAddress.substring(0, 50)]);

    result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: ["invalid-email1", "invalid-email2"],
        expectErrors: true,
    });

    expect(result.errors.invalid).toEqual(["invalid-email1", "invalid-email2"]);

    result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: ["invalid-email1", "invalid-email2", test1EmailAddress],
        expectErrors: true,
    });

    expect(result.errors.invalid).toEqual(["invalid-email1", "invalid-email2"]);
    expect(result.errors.alreadyMember).toEqual([test1EmailAddress]);
});

test("can accept space invites via email link", async ({
    browser,
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const ownerSession = await space.createSession({role: "Owner"});
    const document = await TestDocument.create(ownerSession, {
        title: "Test Document",
        access: "Public",
    });

    const memberAccount = await TestAccount.create(context);
    const memberSession = await TestSession.create(memberAccount);
    const memberEmailAddress = await memberAccount.createEmailAddress();

    // Invite the email as owner
    await services.signIn(browserContext, ownerSession);
    await page.goto(`/s/${space.id}/settings/people`);

    const result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: false,
    });

    expect(result.invitePendingEmails).toEqual([
        // We truncate emails to 50 characters for account names
        memberEmailAddress.substring(0, 50),
    ]);

    // Accept via Email link
    const memberBrowser = await browser.newContext();
    await services.signIn(memberBrowser, memberSession);
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto(`/s/${space.id}/invite/accept`);
    await memberPage.waitForURL(`**/s/${space.id}?from=invite`);

    // Verify we can see the document created
    await memberPage.goto(`/s/${space.id}/documents/${document.id}`);
    const editor1 = memberPage.getByRole("textbox", {name: "Document"});
    await expect(editor1).toBeVisible();

    await memberBrowser.close();
});

test("can accept space invites via redirect", async ({browser, context: browserContext, page}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const ownerSession = await space.createSession({role: "Owner"});
    const document = await TestDocument.create(ownerSession, {
        title: "Test Document",
        access: "Public",
    });

    const memberAccount = await TestAccount.create(context);
    const memberSession = await TestSession.create(memberAccount);
    const memberEmailAddress = await memberAccount.createEmailAddress();

    // Invite the email as owner
    await services.signIn(browserContext, ownerSession);
    await page.goto(`/s/${space.id}/settings/people`);

    const result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: false,
    });

    expect(result.invitePendingEmails).toEqual([
        // We truncate emails to 50 characters for account names
        memberEmailAddress.substring(0, 50),
    ]);

    // Accept via redirected link
    const memberBrowser = await browser.newContext();
    await services.signIn(memberBrowser, memberSession);
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto(`/s/${space.id}/documents/${document.id}`);

    // Redirect to invite
    await memberPage.waitForURL(`**/s/${space.id}/invite?to=%2Fdocuments%2F${document.id}`);
    await memberPage.getByRole("button", {name: `Join Test Space`}).click();

    // Verify we were redirected and can see the document created
    await memberPage.waitForURL(`**/s/${space.id}/documents/${document.id}`);
    const editor2 = memberPage.getByRole("textbox", {name: "Document"});
    await expect(editor2).toBeVisible();

    await memberBrowser.close();
});

test("can reject space invites via email link", async ({
    browser,
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const ownerSession = await space.createSession({role: "Owner"});

    const memberAccount = await TestAccount.create(context);
    const memberSession = await TestSession.create(memberAccount);
    const memberEmailAddress = await memberAccount.createEmailAddress();

    // Invite the email as owner
    await services.signIn(browserContext, ownerSession);
    await page.goto(`/s/${space.id}/settings/people`);

    let result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: false,
    });

    expect(result.invitePendingEmails).toEqual([
        // We truncate emails to 50 characters for account names
        memberEmailAddress.substring(0, 50),
    ]);

    // Reject via Email link
    const memberBrowser = await browser.newContext();
    await services.signIn(memberBrowser, memberSession);
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto(`/s/${space.id}/invite/reject-and-mark-as-spam`);
    await memberPage.waitForSelector(`[data-testid="RejectSpaceAccountInviteAsSpamCompleted"]`, {
        state: "attached",
    });

    // settings doesn't have realtime updates, so reload
    await page.reload();

    // Try to invite the user again
    result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: true,
    });

    expect(result.errors.rejectedPreviousInvite).toEqual([memberEmailAddress]);
    expect(result.invitePendingEmails).toEqual([]);

    await memberBrowser.close();
});

test("can reject space invites via redirect", async ({browser, context: browserContext, page}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const ownerSession = await space.createSession({role: "Owner"});
    const document = await TestDocument.create(ownerSession, {
        title: "Test Document",
        access: "Public",
    });

    const memberAccount = await TestAccount.create(context);
    const memberSession = await TestSession.create(memberAccount);
    const memberEmailAddress = await memberAccount.createEmailAddress();

    // Invite the email as owner
    await services.signIn(browserContext, ownerSession);
    await page.goto(`/s/${space.id}/settings/people`);

    let result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: false,
    });

    expect(result.invitePendingEmails).toEqual([
        // We truncate emails to 50 characters for account names
        memberEmailAddress.substring(0, 50),
    ]);

    // Reject via redirected link
    const memberBrowser = await browser.newContext();
    await services.signIn(memberBrowser, memberSession);
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto(`/s/${space.id}/documents/${document.id}`);

    // Redirect to invite
    await memberPage.waitForURL(`**/s/${space.id}/invite?to=%2Fdocuments%2F${document.id}`);
    await memberPage.getByRole("button", {name: `Report this invitation as spam`}).click();
    await memberPage.waitForSelector(`[data-testid="RejectSpaceAccountInviteAsSpamCompleted"]`, {
        state: "attached",
    });

    // settings doesn't have realtime updates, so reload
    await page.reload();

    // Try to invite the user again
    result = await inviteEmailAddressesAndGetResults(page, {
        emailAddresses: [memberEmailAddress],
        expectErrors: true,
    });

    expect(result.errors.rejectedPreviousInvite).toEqual([memberEmailAddress]);
    expect(result.invitePendingEmails).toEqual([]);

    await memberBrowser.close();
});
