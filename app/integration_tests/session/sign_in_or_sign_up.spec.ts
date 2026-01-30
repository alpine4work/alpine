import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {generateId} from "~/shared/id/id.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const {services} = createTestServices();

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

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeDisabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeEnabled();
    await expect(page.getByText("Tip: Using your work email")).toBeVisible();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    expect(services.getOneTimePasswords().length).toBe(0);

    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();

    const {oneTimePassword} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page.getByPlaceholder("Anthony Mose").click();
    await page.getByPlaceholder("Anthony Mose").fill("Test Testerson");

    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();
    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await expect(page.getByText("We sent a passcode to")).toBeVisible();

    await page.getByLabel("Passcode").click();
    await page.getByLabel("Passcode").fill(oneTimePassword);

    if (isMobile) {
        await expect(page.getByText("Also try Alpine on a computer")).toBeVisible();
        await page.getByRole("button", {name: "Continue"}).click();
        await expect(page.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await expect(page.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page.getByText("added to this space with you")).toBeHidden();
});

test("can sign up with work email", async ({page, isMobile}) => {
    await page.goto("/auth/sign-up");

    const emailId = generateId();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test@company-${emailId}`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeDisabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test@company-${emailId}.`);

    await expect(page.getByRole("button", {name: "Sign up"})).toBeEnabled();
    await expect(page.getByText("Tip: Using your work email")).toBeHidden();

    await page.getByPlaceholder("name@company.com").click();
    await page.getByPlaceholder("name@company.com").fill(`test@company-${emailId}.com`);

    expect(services.getOneTimePasswords().length).toBe(0);

    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();

    const {oneTimePassword} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page.getByPlaceholder("Anthony Mose").click();
    await page.getByPlaceholder("Anthony Mose").fill("Test Testerson");

    await expect(page.getByRole("img", {name: "Green tree"})).toBeVisible();
    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await page.getByRole("button", {name: "Sign up"}).click();
    await expect(page.getByRole("img", {name: "Green tree"})).toBeHidden();
    await expect(page.getByText("We sent a passcode to")).toBeVisible();

    await page.getByLabel("Passcode").click();
    await page.getByLabel("Passcode").fill(oneTimePassword);

    if (isMobile) {
        await expect(page.getByText("Also try Alpine on a computer")).toBeVisible();
        await page.getByRole("button", {name: "Continue"}).click();
        await expect(page.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page.getByText("We sent a passcode to")).toBeHidden();
    await expect(page.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page.getByText("added to this space with you")).toBeVisible();
});

test("can sign up with work email to space that already has accounts", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.1@company-${emailId}.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test 1");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("added to this space with you")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();
    await expect(page1.getByText("Test 2")).toBeHidden();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.2@company-${emailId}.com`);
    await page2.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword2} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByPlaceholder("Anthony Mose").click();
    await page2.getByPlaceholder("Anthony Mose").fill("Test 2");
    await page2.getByRole("button", {name: "Sign up"}).click();
    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword2);

    if (isMobile) {
        await expect(page2.getByText("Also try Alpine on a computer")).toBeVisible();
        await page2.getByRole("button", {name: "Continue"}).click();
        await expect(page2.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("added to this space with you")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeVisible();
    await expect(page2.getByText("Test 2")).toBeHidden();

    await page2.close();

    const browserContext3 = await browser.newContext();
    const page3 = await browserContext3.newPage();
    await page3.goto("/auth/sign-up");

    await page3.getByPlaceholder("name@company.com").click();
    await page3.getByPlaceholder("name@company.com").fill(`test.3@company-${emailId}.com`);
    await page3.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword3} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(3);
        return services.getOneTimePasswords()[2]!;
    });

    await page3.getByPlaceholder("Anthony Mose").click();
    await page3.getByPlaceholder("Anthony Mose").fill("Test 3");
    await page3.getByRole("button", {name: "Sign up"}).click();
    await page3.getByLabel("Passcode").click();
    await page3.getByLabel("Passcode").fill(oneTimePassword3);

    if (isMobile) {
        await expect(page3.getByText("Also try Alpine on a computer")).toBeVisible();
        await page3.getByRole("button", {name: "Continue"}).click();
        await expect(page3.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page3.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page3.getByText("added to this space with you")).toBeVisible();
    await expect(page3.getByText("Test 1")).toBeVisible();
    await expect(page3.getByText("Test 2")).toBeVisible();

    await page3.close();
});

test("can sign up from invite link", async ({browser, page: page1, isMobile}) => {
    await page1.goto("/auth/sign-up");

    const emailId1 = generateId();
    const emailId2 = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId1}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test 1");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();

    if (isMobile) {
        await page1.getByLabel("More").click();
        await page1.getByText("Settings").click();
        await page1.getByText("People").click();
    } else {
        await page1.getByLabel("Space").click();
        await page1.getByRole("menuitem", {name: "People"}).click();
    }
    await page1.getByRole("button", {name: "Invite"}).click();
    await page1.getByPlaceholder("jane@company.com").click();
    await page1.getByPlaceholder("jane@company.com").fill(`test.${emailId2}@gmail.com`);

    expect(services.getInviteUrls().length).toBe(0);

    await page1.getByRole("button", {name: "Send"}).click();

    const {inviteUrl} = await waitForExpect(() => {
        expect(services.getInviteUrls().length).toBe(1);
        return services.getInviteUrls()[0]!;
    });

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(inviteUrl);

    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId2}@gmail.com`,
    );

    await page2.getByRole("button", {name: "Sign in"}).click();

    const {oneTimePassword: oneTimePassword2} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByPlaceholder("Anthony Mose").click();
    await page2.getByPlaceholder("Anthony Mose").fill("Test 2");
    await page2.getByRole("button", {name: "Sign up"}).click();
    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword2);

    if (isMobile) {
        await expect(page2.getByText("Also try Alpine on a computer")).toBeVisible();
        await page2.getByRole("button", {name: "Continue"}).click();
        await expect(page2.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page2.getByText("Test 1")).toBeVisible();

    await page2.close();
});

test("can sign in", async ({browser, page: page1, isMobile}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test Testerson");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-in");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page2.getByRole("button", {name: "Sign in"}).click();

    const {oneTimePassword: oneTimePassword2} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword2);

    await expect(page2.getByText("Welcome to Alpine")).toBeVisible();

    await page2.close();
});

test("can sign in from invite link", async ({browser, page: page1, isMobile}) => {
    await page1.goto("/auth/sign-up");

    const emailId1 = generateId();
    const emailId2 = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId1}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test 1");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();
    await expect(page1.getByText("Test 1")).toBeHidden();

    if (isMobile) {
        await page1.getByLabel("More").click();
        await page1.getByText("Settings").click();
        await page1.getByText("People").click();
    } else {
        await page1.getByLabel("Space").click();
        await page1.getByRole("menuitem", {name: "People"}).click();
    }
    await page1.getByRole("button", {name: "Invite"}).click();
    await page1.getByPlaceholder("jane@company.com").click();
    await page1.getByPlaceholder("jane@company.com").fill(`test.${emailId2}@gmail.com`);

    expect(services.getInviteUrls().length).toBe(0);

    await page1.getByRole("button", {name: "Send"}).click();

    const {inviteUrl} = await waitForExpect(() => {
        expect(services.getInviteUrls().length).toBe(1);
        return services.getInviteUrls()[0]!;
    });

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId2}@gmail.com`);
    await page2.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword2} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByPlaceholder("Anthony Mose").click();
    await page2.getByPlaceholder("Anthony Mose").fill("Test 2");
    await page2.getByRole("button", {name: "Sign up"}).click();
    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword2);

    if (isMobile) {
        await expect(page2.getByText("Also try Alpine on a computer")).toBeVisible();
        await page2.getByRole("button", {name: "Continue"}).click();
        await expect(page2.getByText("Also try Alpine on a computer")).toBeHidden();
    }

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

    const {oneTimePassword: oneTimePassword3} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(3);
        return services.getOneTimePasswords()[2]!;
    });

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
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test Testerson");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();

    await page2.getByRole("button", {name: "Sign up"}).click();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeVisible();
    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId}@gmail.com`,
    );

    await expect(page2.getByRole("button", {name: "Sign up"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Sign in"})).toBeHidden();

    await page2.getByRole("link", {name: "signing in", exact: true}).click();

    await expect(page2.getByRole("button", {name: "Sign up"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Sign in"})).toBeVisible();

    await expect(page2.getByText("Couldn\u2019t sign up. The email")).toBeHidden();
    await expect(page2.getByPlaceholder("name@company.com")).toHaveValue(
        `test.${emailId}@gmail.com`,
    );

    await page2.close();
});

test("can restart sign up if sign up hasn\u2019t finished", async ({
    browser,
    page: page1,
    isMobile,
}) => {
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test 1");
    await page1.getByRole("button", {name: "Sign up"}).click();

    await expect(page1.getByText("We sent a passcode to")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-up");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    await page2.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByPlaceholder("Anthony Mose").click();
    await page2.getByPlaceholder("Anthony Mose").fill("Test 2");
    await page2.getByRole("button", {name: "Sign up"}).click();
    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword);

    if (isMobile) {
        await expect(page2.getByText("Also try Alpine on a computer")).toBeVisible();
        await page2.getByRole("button", {name: "Continue"}).click();
        await expect(page2.getByText("Also try Alpine on a computer")).toBeHidden();
    }

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

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test 1");
    await page1.getByRole("button", {name: "Sign up"}).click();

    await expect(page1.getByText("We sent a passcode to")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto("/auth/sign-in");

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

    await page2.getByRole("button", {name: "Sign in"}).click();

    const {oneTimePassword} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(2);
        return services.getOneTimePasswords()[1]!;
    });

    await page2.getByPlaceholder("Anthony Mose").click();
    await page2.getByPlaceholder("Anthony Mose").fill("Test 2");
    await page2.getByRole("button", {name: "Sign up"}).click();
    await page2.getByLabel("Passcode").click();
    await page2.getByLabel("Passcode").fill(oneTimePassword);

    if (isMobile) {
        await expect(page2.getByText("Also try Alpine on a computer")).toBeVisible();
        await page2.getByRole("button", {name: "Continue"}).click();
        await expect(page2.getByText("Also try Alpine on a computer")).toBeHidden();
    }

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
    await page1.goto("/auth/sign-up");

    const emailId = generateId();

    await page1.getByPlaceholder("name@company.com").click();
    await page1.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);
    await page1.getByRole("button", {name: "Sign up"}).click();

    const {oneTimePassword: oneTimePassword1} = await waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBe(1);
        return services.getOneTimePasswords()[0]!;
    });

    await page1.getByPlaceholder("Anthony Mose").click();
    await page1.getByPlaceholder("Anthony Mose").fill("Test Testerson");
    await page1.getByRole("button", {name: "Sign up"}).click();
    await page1.getByLabel("Passcode").click();
    await page1.getByLabel("Passcode").fill(oneTimePassword1);

    if (isMobile) {
        await expect(page1.getByText("Also try Alpine on a computer")).toBeVisible();
        await page1.getByRole("button", {name: "Continue"}).click();
        await expect(page1.getByText("Also try Alpine on a computer")).toBeHidden();
    }

    await expect(page1.getByText("Welcome to Alpine")).toBeVisible();

    const browserContext2 = await browser.newContext();
    const page2 = await browserContext2.newPage();
    await page2.goto(`/auth/sign-up?to=${encodeURIComponent("/create-space")}`);

    await page2.getByPlaceholder("name@company.com").click();
    await page2.getByPlaceholder("name@company.com").fill(`test.${emailId}@gmail.com`);

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
