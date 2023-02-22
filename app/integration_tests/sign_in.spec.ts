import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {approveAlphaAccessRequest} from "~/server/dynamo/alpha_access_table";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {seedDynamo} from "~/server/dynamo/seed_dynamo";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {validateEmailAddress} from "~/server/emails/email_address";
import {generateId} from "~/shared/id/id";

const context = createTestContext();

let oneTimePasswords: Array<string> = [];

createTestServer(context, {
    globals: {
        __logOneTimePassword: ({oneTimePassword}: {oneTimePassword: string}) => {
            oneTimePasswords.push(oneTimePassword);
        },
    },
});

const space = createTestSpace(context);
const adminSession = createTestSession(context, space, {hasInternalAccess: true});

const emailAddress = `test.${generateId()}@test.cyberworlds.dev`;

test.beforeAll(async () => {
    await seedDynamo(context);
});

test("can request alpha access", async ({page}) => {
    await page.goto("/");

    await expect(page.getByRole("button", {name: "Request"})).toBeDisabled();
    await page.getByLabel("Name").type("Test");
    await page.getByLabel("Email address").type(emailAddress);
    await expect(page.getByRole("button", {name: "Request"})).toBeEnabled();

    await expect(page.getByText("Requested access")).toBeHidden();
    await page.getByRole("button", {name: "Request"}).click();
    await expect(page.getByText("Requested access")).toBeVisible();
});

test("can not sign in if access has not been approved", async ({page}) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("button", {name: "Sign in"})).toBeDisabled();
    await page.getByLabel("Email address").type(emailAddress);
    await expect(page.getByRole("button", {name: "Sign in"})).toBeEnabled();

    await expect(page.getByText("Could not sign in")).toBeHidden();
    await expect(page.getByText("We sent a sign in code to")).toBeHidden();
    await page.getByRole("button", {name: "Sign in"}).click();
    await expect(page.getByText("Could not sign in")).toBeVisible();
    await expect(page.getByText("We sent a sign in code to")).toBeHidden();
});

test("can sign in after access is approved", async ({page}) => {
    await approveAlphaAccessRequest(
        context.request(adminSession),
        await validateEmailAddress(context, emailAddress),
    );

    await page.goto("/sign-in");

    await expect(page.getByRole("button", {name: "Sign in"})).toBeDisabled();
    await page.getByLabel("Email address").type(emailAddress);
    await expect(page.getByRole("button", {name: "Sign in"})).toBeEnabled();

    expect(oneTimePasswords.length).toEqual(0);
    await expect(page.getByText("Could not sign in")).toBeHidden();
    await expect(page.getByText("We sent a sign in code to")).toBeHidden();
    await page.getByRole("button", {name: "Sign in"}).click();
    await expect(page.getByText("Could not sign in")).toBeHidden();
    await expect(page.getByText("We sent a sign in code to")).toBeVisible();
    expect(oneTimePasswords.length).toEqual(1);

    const oneTimePassword = oneTimePasswords[0]!;
    oneTimePasswords = [];

    await expect(page).not.toHaveURL(new RegExp(getDynamoSeedConstants().defaultSpaceId));
    await page.getByLabel("Sign in code").type(oneTimePassword);
    await expect(page).toHaveURL(new RegExp(getDynamoSeedConstants().defaultSpaceId));
});
