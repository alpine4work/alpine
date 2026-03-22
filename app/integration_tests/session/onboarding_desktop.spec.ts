import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {generateId} from "~/shared/id/id.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";

const {services} = createTestServices();

async function waitForOneTimePassword(index: number) {
    return waitForExpect(() => {
        expect(services.getOneTimePasswords().length).toBeGreaterThan(index);
        return services.getOneTimePasswords()[index]!.oneTimePassword;
    });
}

const onboardingHintsTestCases: Array<{
    name: string;
    firstEdit: (page: Page) => Promise<void>;
    secondEdit: (page: Page) => Promise<void>;
    thirdEdit: (page: Page) => Promise<void>;
}> = [
    {
        name: "document",
        firstEdit: async page => {
            await page.getByLabel("Create document").click();
            await page.getByRole("textbox", {name: "Document"}).getByRole("paragraph").click();
            await expect(page).toHaveURL(/[?&]create/);
            await page.getByRole("textbox", {name: "Document"}).press("a");
            await expect(page).not.toHaveURL(/[?&]create/);
            await page.getByRole("textbox", {name: "Document"}).press("b");
        },
        secondEdit: async page => {
            await page.getByRole("textbox", {name: "Document"}).press("c");
        },
        thirdEdit: async page => {
            await page.getByRole("textbox", {name: "Document"}).press("d");
        },
    },
    {
        name: "project",
        firstEdit: async page => {
            await page.getByLabel("Create project").click();
            await expect(page).toHaveURL(/[?&]create/);
            await page
                .getByTestId(/^TaskRowView:/)
                .last()
                .getByLabel("Title")
                .press("a");
            await expect(page).not.toHaveURL(/[?&]create/);
            await page
                .getByTestId(/^TaskRowView:/)
                .last()
                .getByLabel("Title")
                .press("b");
        },
        secondEdit: async page => {
            await page
                .getByTestId(/^TaskRowView:/)
                .last()
                .getByLabel("Title")
                .press("c");
        },
        thirdEdit: async page => {
            await page
                .getByTestId(/^TaskRowView:/)
                .last()
                .getByLabel("Title")
                .press("d");
        },
    },
];

for (const {name, firstEdit, secondEdit, thirdEdit} of onboardingHintsTestCases) {
    test(`onboarding hints when creating a ${name}`, async ({page}) => {
        const emailAddress = `test.${generateId()}@gmail.com`;

        await page.clock.install();
        await page.goto("/auth/sign-up");
        await page.getByPlaceholder("name@company.com").fill(emailAddress);
        await page.getByRole("button", {name: "Sign up"}).click();
        await page.getByPlaceholder("Anthony Mose").fill("Test Testerson");
        await page.getByRole("button", {name: "Sign up"}).click();
        await page.getByRole("link", {name: "Skip for now"}).click();
        await page.getByRole("button", {name: "Skip for now"}).click();
        await page.getByLabel("Passcode").fill(await waitForOneTimePassword(0));
        await page.getByRole("button", {name: "Sign up"}).click();

        const shareActivationHintLocator = page.getByText(`share your ${name} with others`);
        const searchEducationHintLocator = page.getByText("try opening search");

        await expect(page.getByText("Test\u2019s Space", {exact: true})).toBeVisible();
        await expect(page.getByTestId(/^ContentFileEntityPreview:/)).toBeHidden();

        await firstEdit(page);

        await expect(page.getByText("Test\u2019s Space", {exact: true})).toBeHidden();
        await expect(page.getByTestId(/^ContentFileEntityPreview:/)).toBeHidden();

        // The share activation hint only shows up after ~24 seconds of editing. This time
        // is measured in `markSearchAffinityLowIntentUpdateEntityInteraction()` calls.
        // Simulate 24 seconds of editing by fast forwarding the clock.
        await page.clock.runFor(1000 * 60);

        await expect(shareActivationHintLocator).toBeHidden();
        await expect(searchEducationHintLocator).toBeHidden();

        await secondEdit(page);

        await expect(shareActivationHintLocator).toBeVisible();
        await expect(searchEducationHintLocator).toBeHidden();

        await page.getByRole("button", {name: "Share"}).click();
        await expect(page.getByTestId("ShareOverlay")).toBeVisible();

        await expect(shareActivationHintLocator).toBeHidden();
        await expect(searchEducationHintLocator).toBeHidden();

        await page.keyboard.press("Escape");
        await expect(page.getByTestId("ShareOverlay")).toBeHidden();

        await expect(shareActivationHintLocator).toBeHidden();
        await expect(searchEducationHintLocator).toBeHidden();

        await thirdEdit(page);

        await expect(shareActivationHintLocator).toBeHidden();
        await expect(searchEducationHintLocator).toBeHidden();

        await expect(page.getByText("Test\u2019s Space", {exact: true})).toBeHidden();
        await expect(page.getByTestId(/^ContentFileEntityPreview:/)).toBeHidden();
        await page.getByLabel("Home").click();
        await expect(page.getByText("Test\u2019s Space", {exact: true})).toBeVisible();
        await expect(page.getByTestId(/^ContentFileEntityPreview:/)).toBeVisible();

        await expect(shareActivationHintLocator).toBeHidden();
        await expect(searchEducationHintLocator).toBeHidden();

        await page.getByTestId(/^ContentFileEntityPreview:/).click();
        await page.getByLabel("Expand").click();

        // We only show a hint 1s after its condition is met so `useHintOracle()` has a
        // chance to see all hints whose conditions have been met and choose to show only
        // the highest priority hint.
        await page.clock.runFor(1000 * 5);

        await expect(searchEducationHintLocator).toBeVisible();
        await expect(shareActivationHintLocator).toBeHidden();

        await expect(page.getByTestId("SearchModal")).toBeHidden();
        await page.getByLabel("Search").click();
        await expect(page.getByTestId("SearchModal")).toBeVisible();

        await expect(searchEducationHintLocator).toBeHidden();
        await expect(shareActivationHintLocator).toBeHidden();

        await page.keyboard.press("Escape");
        await expect(page.getByTestId("SearchModal")).toBeHidden();

        await expect(searchEducationHintLocator).toBeHidden();
        await expect(shareActivationHintLocator).toBeHidden();
    });
}
