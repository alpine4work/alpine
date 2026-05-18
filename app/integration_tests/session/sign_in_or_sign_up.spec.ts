import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {generateId} from "~/shared/id/id.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const {services} = createTestServices();

async function startSignUp(page: Page, emailAddress: string) {
    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(emailAddress);
    await page.getByRole("button", {name: "Sign up"}).click();
}

async function submitSignUpProfile(page: Page, name: string) {
    await page.getByPlaceholder("Anthony Mose").click();
    await page.getByPlaceholder("Anthony Mose").fill(name);
    await page.getByRole("button", {name: "Sign up"}).click();

    await expect(page.getByRole("button", {name: "Invite"})).toBeVisible();
}

async function openSkipInviteModal(page: Page) {
    await page.getByRole("link", {name: "Skip for now"}).click();
}

async function skipSignUpInvites(page: Page) {
    await openSkipInviteModal(page);
    await page.getByRole("button", {name: "Skip for now"}).click();
}

async function fillInviteEmailAddress(page: Page, index: number, emailAddress: string) {
    await page.getByLabel("Invite email address").nth(index).click();
    await page.getByLabel("Invite email address").nth(index).fill(emailAddress);
}

async function continueSignUpWithInvites(page: Page, inviteEmailAddresses: ReadonlyArray<string>) {
    for (const [index, inviteEmailAddress] of inviteEmailAddresses.entries()) {
        await fillInviteEmailAddress(page, index, inviteEmailAddress);
    }

    await page.getByRole("button", {name: "Invite"}).click();
}

async function waitForOneTimePassword(index: number) {
    return waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBeGreaterThan(index);
        return services.getOneTimePasswords()[index]!;
    });
}

async function waitForInviteUrl(index: number) {
    return waitForExpect(() => {
        expect(services.getInviteUrls().length).toBeGreaterThan(index);
        return services.getInviteUrls()[index]!;
    });
}

async function submitSignUpOneTimePassword({
    page,
    isMobile,
    oneTimePasswordIndex,
}: {
    page: Page;
    isMobile: boolean;
    oneTimePasswordIndex: number;
}) {
    const {oneTimePassword} = await waitForOneTimePassword(oneTimePasswordIndex);

    await expect(page.getByText("We sent a passcode to")).toBeVisible();
    await page.getByLabel("Passcode").click();
    await page.getByLabel("Passcode").fill(oneTimePassword);

    if (isMobile) {
        await expect(page.getByText("Also try Alpine on a computer")).toBeVisible();
        await page.getByRole("button", {name: "Continue"}).click();
        await expect(page.getByText("Also try Alpine on a computer")).toBeHidden();
    }
}

async function signUpWithSkippedInvites({
    page,
    emailAddress,
    name,
    oneTimePasswordIndex,
    isMobile,
}: {
    page: Page;
    emailAddress: string;
    name: string;
    oneTimePasswordIndex: number;
    isMobile: boolean;
}) {
    await page.goto("/auth/sign-up");
    await startSignUp(page, emailAddress);
    await submitSignUpProfile(page, name);
    await skipSignUpInvites(page);
    await submitSignUpOneTimePassword({page, isMobile, oneTimePasswordIndex});
}

async function goToPeopleSettings(page: Page, isMobile: boolean) {
    if (isMobile) {
        await page.getByLabel("More").click();
        await page.getByText("Settings").click();
        await page.getByText("People").click();
    } else {
        await page.getByLabel("Space").click();
        await page.getByRole("menuitem", {name: "People", exact: true}).click();
    }
}

function getCurrentSpaceId(page: Page): string {
    const match = page.url().match(/\/s\/([^/?#]+)/);
    expect(match).not.toBeNull();
    return match![1]!;
}

test("can switch between sign in and sign up page", async ({page}) => {
    await page.goto("/auth/sign-up");

    await expect(page.getByRole("button", {name: "Sign up"})).toBeVisible();

    await page.getByRole("link", {name: "Sign in"}).click();

    await expect(page.getByRole("button", {name: "Sign in"})).toBeVisible();

    await page.getByRole("link", {name: "Sign up"}).click();

    await expect(page.getByRole("button", {name: "Sign up"})).toBeVisible();
});

test("can sign up with personal email", async ({page, isMobile}) => {
    await page.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeDisabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeEnabled();
    await expect(page.getByText("Tip: Using your work email")).toBeVisible();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(emailAddress);

    expect(services.getOneTimePasswords().length).toBe(0);

    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();

    await submitSignUpProfile(page, "Test Testerson");

    await expect(page.getByRole("button", {name: "Invite"})).toBeDisabled();

    await openSkipInviteModal(page);
    await expect(page.getByText("Your team will thank you")).toBeVisible();
    await page.getByRole("button", {name: "Go back"}).click();
    await expect(page.getByText("Your team will thank you")).toBeHidden();

    await skipSignUpInvites(page);

    expect(services.getInviteUrls().length).toBe(0);

    await submitSignUpOneTimePassword({page, isMobile, oneTimePasswordIndex: 0});

    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await expect(page.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page.getByText("added to this space with you")).toBeHidden();
});

test("can sign up with work email", async ({page, isMobile}) => {
    await page.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test@company-${emailId}.com`;

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test@company-${emailId}`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeDisabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test@company-${emailId}.`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeEnabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(emailAddress);

    expect(services.getOneTimePasswords().length).toBe(0);

    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();

    await submitSignUpProfile(page, "Test Testerson");
    await skipSignUpInvites(page);

    await submitSignUpOneTimePassword({page, isMobile, oneTimePasswordIndex: 0});

    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await expect(page.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page.getByText("added to this space with you")).toBeVisible();
});

test("can sign up with work email and invite coworker with inferred domain", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.1@company-${emailId}.com`;
    const coworkerAlias = `test.2.${generateId()}`;

    await startSignUp(page1, emailAddress);
    await submitSignUpProfile(page1, "Test 1");

    await expect(page1.getByLabel("Invite email address")).toHaveCount(3);
    await expect(page1.getByLabel("Invite email address").nth(0)).toHaveAttribute(
        "placeholder",
        "name",
    );
    await expect(page1.getByLabel("Invite email address").nth(1)).toHaveAttribute(
        "placeholder",
        "name",
    );
    await expect(page1.getByLabel("Invite email address").nth(2)).toHaveAttribute(
        "placeholder",
        "name",
    );

    await continueSignUpWithInvites(page1, [coworkerAlias]);
    await submitSignUpOneTimePassword({page: page1, isMobile, oneTimePasswordIndex: 0});

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("added to this space with you")).toBeVisible();

    const expectedCoworkerEmailAddress = `${coworkerAlias}@company-${emailId}.com`;

    const {emailAddress: inviteEmailAddress, inviteUrl} = await waitForInviteUrl(0);
    expect(inviteEmailAddress).toBe(expectedCoworkerEmailAddress);

    await expect(
        page1.getByTestId("SearchAffinityEntityView").getByText(coworkerAlias, {exact: false}),
    ).toBeVisible();

    if (!isMobile) {
        await page1.getByRole("button", {name: "Create"}).click();
        const chatMessageMenuItem = page1
            .getByRole("menubar", {name: "Create"})
            .getByRole("menuitem", {name: /^Chat message\b/});
        await expect(chatMessageMenuItem).toBeVisible();
        await chatMessageMenuItem.focus();
        await chatMessageMenuItem.press("Enter");

        const suggestions = page1.getByRole("listbox", {name: "Suggestions"});
        await expect(suggestions).toBeVisible();
        await expect(
            suggestions.getByRole("option").filter({hasText: coworkerAlias}),
        ).toBeVisible();
    }

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(inviteUrl);

    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(
        expectedCoworkerEmailAddress,
    );

    await page2.getByRole("button", {name: "Sign in"}).click();
    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);
    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeVisible();

    await page2.close();
});

test("invited account chat shows pending invite message", async ({page, isMobile}) => {
    await page.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.1@company-${emailId}.com`;
    const invitedEmailAlias = `test.pending.${generateId()}`;
    const invitedEmailAddress = `${invitedEmailAlias}@company-${emailId}.com`;

    await startSignUp(page, emailAddress);
    await submitSignUpProfile(page, "Test 1");
    await continueSignUpWithInvites(page, [invitedEmailAlias]);
    await submitSignUpOneTimePassword({page, isMobile, oneTimePasswordIndex: 0});

    await expect(page.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page.getByText("added to this space with you")).toBeVisible();

    const {emailAddress: inviteEmailAddress} = await waitForInviteUrl(0);
    expect(inviteEmailAddress).toBe(invitedEmailAddress);

    // Invited accounts use the email as display name and are truncated in some
    // surfaces.
    const invitedAccountName = invitedEmailAddress.substring(0, 50);

    if (isMobile) {
        const spaceId = getCurrentSpaceId(page);
        await page.goto(`/s/${spaceId}/chat/new`);

        await page.getByRole("combobox", {name: "To"}).click();
        await page.getByRole("option", {name: invitedAccountName, exact: true}).click();
    } else {
        await expect(page.getByText(invitedAccountName, {exact: true})).toBeVisible();
        await page.getByText(invitedAccountName, {exact: true}).click();
    }

    const pendingInviteOverlay = page.getByTestId("ChatDirectOneOnOneInvitePendingOverlay");
    await expect(pendingInviteOverlay).toBeVisible();
    await expect(pendingInviteOverlay).toContainText("join you in Alpine");
    await expect(
        pendingInviteOverlay.getByRole("button", {name: "Copy invite link"}),
    ).toBeVisible();
});

test("company sign up can invite outside domain and opens personal space", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.1@company-${emailId}.com`;
    const invitedEmailAlias = `test.2.${generateId()}`;
    const invitedEmailAddress = `${invitedEmailAlias}@gmail.com`;
    const inferredDomain = `@company-${emailId}.com`;

    await startSignUp(page1, emailAddress);
    await submitSignUpProfile(page1, "Test 1");

    await expect(page1.getByText(inferredDomain)).toHaveCount(3);

    await fillInviteEmailAddress(page1, 0, invitedEmailAlias);
    await expect(page1.getByText(inferredDomain)).toHaveCount(3);

    await fillInviteEmailAddress(page1, 0, `${invitedEmailAlias}@`);
    await expect(page1.getByLabel("Invite email address").nth(0)).toHaveValue(
        `${invitedEmailAlias}@`,
    );
    await expect(page1.getByText(inferredDomain)).toHaveCount(2);

    await fillInviteEmailAddress(page1, 0, invitedEmailAddress);
    await page1.getByRole("button", {name: "Invite"}).click();
    await submitSignUpOneTimePassword({page: page1, isMobile, oneTimePasswordIndex: 0});

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("added to this space with you")).toBeHidden();

    const {emailAddress: inviteEmailAddress, inviteUrl} = await waitForInviteUrl(0);
    expect(inviteEmailAddress).toBe(invitedEmailAddress);

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(inviteUrl);

    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(invitedEmailAddress);

    await page2.close();
});

test("invite email addresses persist after reload", async ({page}) => {
    await page.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;
    const invitedEmailAddress1 = `test.1.${generateId()}@gmail.com`;
    const invitedEmailAddress2 = `test.2.${generateId()}@gmail.com`;

    await startSignUp(page, emailAddress);
    await submitSignUpProfile(page, "Test 1");

    await fillInviteEmailAddress(page, 0, invitedEmailAddress1);
    await fillInviteEmailAddress(page, 1, invitedEmailAddress2);

    await page.reload();

    await startSignUp(page, emailAddress);
    await submitSignUpProfile(page, "Test 2");

    await expect(page.getByLabel("Invite email address").nth(0)).toHaveValue(invitedEmailAddress1);
    await expect(page.getByLabel("Invite email address").nth(1)).toHaveValue(invitedEmailAddress2);
});

test("can sign up with work email to space that already has accounts", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await startSignUp(page1, `test.1@company-${emailId}.com`);
    await submitSignUpProfile(page1, "Test 1");
    await skipSignUpInvites(page1);
    await submitSignUpOneTimePassword({page: page1, isMobile, oneTimePasswordIndex: 0});

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("added to this space with you")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();
    await expect(page1.getByText("Test 2")).toBeHidden();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await startSignUp(page2, `test.2@company-${emailId}.com`);
    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);
    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("added to this space with you")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeVisible();
    await expect(page2.getByText("Test 2")).toBeHidden();

    await page2.close();

    const browserContext3 = await browser.newContext();
    const page3 = await browserContext3.newPage();
    await page3.goto("/auth/sign-up");

    await startSignUp(page3, `test.3@company-${emailId}.com`);
    await submitSignUpProfile(page3, "Test 3");
    await skipSignUpInvites(page3);
    await submitSignUpOneTimePassword({page: page3, isMobile, oneTimePasswordIndex: 2});

    await expect(page3.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page3.getByText("added to this space with you")).toBeVisible();
    await expect(page3.getByText("Test 1")).toBeVisible();
    await expect(page3.getByText("Test 2")).toBeVisible();

    await page3.close();
});

test("can sign up from invite link from settings", async ({browser, page: page1, isMobile}) => {
    await page1.goto("/auth/sign-up");

    const emailId1 = generateId();
    const emailId2 = generateId();

    await startSignUp(page1, `test.${emailId1}@gmail.com`);
    await submitSignUpProfile(page1, "Test 1");
    await skipSignUpInvites(page1);
    await submitSignUpOneTimePassword({page: page1, isMobile, oneTimePasswordIndex: 0});

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();

    if (isMobile) {
        await page1.getByLabel("More").click();
        await page1.getByText("Settings").click();
        await page1.getByText("People").click();
    } else {
        await page1.getByLabel("Space").click();
        await page1.getByRole("menuitem", {name: "People", exact: true}).click();
    }
    await page1.getByRole("button", {name: "Invite"}).click();
    await page1.getByPlaceholder("jane@company.com").click();
    await page1.getByPlaceholder("jane@company.com").fill(`test.${emailId2}@gmail.com`);
    await page1.getByRole("button", {name: "Send"}).click();

    const {inviteUrl} = await waitForInviteUrl(0);

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(inviteUrl);

    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId2}@gmail.com`,
    );

    await page2.getByRole("button", {name: "Sign in"}).click();
    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);
    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeVisible();

    await page2.close();
});

test("can sign in", async ({browser, page: page1, isMobile}) => {
    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await signUpWithSkippedInvites({
        page: page1,
        emailAddress,
        name: "Test Testerson",
        oneTimePasswordIndex: 0,
        isMobile,
    });

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-in");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(emailAddress);
    await page2.getByRole("button", {name: "Sign in"}).click();

    const {oneTimePassword: oneTimePassword2} = await waitForOneTimePassword(1);

    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword2);

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();

    await page2.close();
});

test("can sign in from invite link", async ({browser, page: page1, isMobile}) => {
    await page1.goto("/auth/sign-up");

    const emailId1 = generateId();
    const emailId2 = generateId();

    await startSignUp(page1, `test.${emailId1}@gmail.com`);
    await submitSignUpProfile(page1, "Test 1");
    await skipSignUpInvites(page1);
    await submitSignUpOneTimePassword({page: page1, isMobile, oneTimePasswordIndex: 0});

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();

    await goToPeopleSettings(page1, isMobile);
    await page1.getByRole("button", {name: "Invite"}).click();
    await page1.getByPlaceholder("jane@company.com").click();
    await page1.getByPlaceholder("jane@company.com").fill(`test.${emailId2}@gmail.com`);

    expect(services.getInviteUrls().length).toBe(0);

    await page1.getByRole("button", {name: "Send"}).click();

    const {inviteUrl} = await waitForInviteUrl(0);

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await startSignUp(page2, `test.${emailId2}@gmail.com`);
    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);
    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeHidden();

    await page2.close();

    const browserContext3 = await browser.newContext();
    const page3 = await browserContext3.newPage();
    await page3.goto(inviteUrl);

    await expect(page3.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId2}@gmail.com`,
    );

    await page3.getByRole("button", {name: "Sign in"}).click();

    const {oneTimePassword: oneTimePassword3} = await waitForOneTimePassword(2);

    await page3.getByLabel("Passcode").click();
    await page3.getByLabel("Passcode").fill(oneTimePassword3);

    await expect(page3.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page3.getByText("Test 1")).toBeVisible();

    await page3.close();
});

test("can\u2019t sign in with email that doesn\u2019t have an account", async ({page}) => {
    await page.goto("/auth/sign-in");

    const emailId = generateId();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeHidden();

    await page.getByRole("button", {name: "Sign in"}).click();

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeVisible();
    await expect(page.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId}@gmail.com`,
    );

    await expect(page.getByRole("button", {name: "Sign in"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Sign up"})).toBeHidden();

    await page.getByRole("link", {name: "sign up", exact: true}).click();

    await expect(page.getByRole("button", {name: "Sign in"})).toBeHidden();
    await expect(page.getByRole("button", {name: "Sign up"})).toBeVisible();

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeHidden();
    await expect(page.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId}@gmail.com`,
    );
});

test("can\u2019t sign up with email that already has an account", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await signUpWithSkippedInvites({
        page: page1,
        emailAddress,
        name: "Test Testerson",
        oneTimePasswordIndex: 0,
        isMobile,
    });

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(emailAddress);

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();

    await page2.getByRole("button", {name: "Sign up"}).click();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeVisible();
    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(emailAddress);

    await expect(page2.getByRole("button", {name: "Sign up"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Sign in"})).toBeHidden();

    await page2.getByRole("link", {name: "signing in", exact: true}).click();

    await expect(page2.getByRole("button", {name: "Sign up"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Sign in"})).toBeVisible();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();
    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(emailAddress);

    await page2.close();
});

test("can restart sign up if sign up hasn\u2019t finished", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await startSignUp(page1, emailAddress);
    await submitSignUpProfile(page1, "Test 1");
    await skipSignUpInvites(page1);

    await expect(page1.getByText("We sent a passcode to")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await startSignUp(page2, emailAddress);
    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);

    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();

    await page2.close();
});

test("sign in will redirect to sign up if if sign up hasn\u2019t finished", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await startSignUp(page1, emailAddress);
    await submitSignUpProfile(page1, "Test 1");
    await skipSignUpInvites(page1);

    await expect(page1.getByText("We sent a passcode to")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-in");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(emailAddress);

    await page2.getByRole("button", {name: "Sign in"}).click();

    await submitSignUpProfile(page2, "Test 2");
    await skipSignUpInvites(page2);
    await submitSignUpOneTimePassword({page: page2, isMobile, oneTimePasswordIndex: 1});

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();

    await page2.close();
});

test("can\u2019t sign in with email that doesn\u2019t have an account and preserve `to` search param", async ({
    page,
}) => {
    await page.goto(`/auth/sign-in?to=${encodeURIComponent("/create-space")}`);

    const emailId = generateId();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeHidden();

    await page.getByRole("button", {name: "Sign in"}).click();

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeVisible();

    await page.getByRole("link", {name: "sign up", exact: true}).click();

    await expect(page.getByText("Couldn\u2019t sign in. Can\u2019t find an account")).toBeHidden();
    await expect(page.getByRole("button", {name: "Sign up"})).toBeVisible();

    await expect(page).toHaveURL(/\/auth\/sign-up(?:\?|$)/);
    await expect(page).toHaveURL(/(?:\?|&)to=%2Fcreate-space(?:&|$)/);
});

test("can\u2019t sign up with email that already has an account and preserve `to` search param", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    const emailId = generateId();
    const emailAddress = `test.${emailId}@gmail.com`;

    await signUpWithSkippedInvites({
        page: page1,
        emailAddress,
        name: "Test Testerson",
        oneTimePasswordIndex: 0,
        isMobile,
    });

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(`/auth/sign-up?to=${encodeURIComponent("/create-space")}`);

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(emailAddress);

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();

    await page2.getByRole("button", {name: "Sign up"}).click();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeVisible();

    await page2.getByRole("link", {name: "signing in", exact: true}).click();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();
    await expect(page2.getByRole("button", {name: "Sign in"})).toBeVisible();

    await expect(page2).toHaveURL(/\/auth\/sign-in(?:\?|$)/);
    await expect(page2).toHaveURL(/(?:\?|&)to=%2Fcreate-space(?:&|$)/);

    await page2.close();
});
