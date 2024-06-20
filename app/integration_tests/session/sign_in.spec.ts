import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {seedDynamo} from "~/app/seed_dynamo.js";
import {approveAlphaAccessRequest} from "~/server/alpha/alpha_access_table.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {generateId} from "~/shared/id/id.js";

const {context, services} = createTestServices();
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
        context.action(adminSession),
        await validateEmailAddress(context, emailAddress),
    );

    await page.goto("/sign-in");

    await expect(page.getByRole("button", {name: "Sign in"})).toBeDisabled();
    await page.getByLabel("Email address").type(emailAddress);
    await expect(page.getByRole("button", {name: "Sign in"})).toBeEnabled();

    expect(services.getOneTimePasswords().length).toEqual(0);
    await expect(page.getByText("Could not sign in")).toBeHidden();
    await expect(page.getByText("We sent a sign in code to")).toBeHidden();
    await page.getByRole("button", {name: "Sign in"}).click();
    await expect(page.getByText("Could not sign in")).toBeHidden();
    await expect(page.getByText("We sent a sign in code to")).toBeVisible();
    expect(services.getOneTimePasswords().length).toEqual(1);

    const {emailAddress: oneTimePasswordEmailAddress, oneTimePassword} =
        services.getOneTimePasswords()[0]!;
    expect(oneTimePasswordEmailAddress).toEqual(emailAddress);

    await expect(page).not.toHaveURL(new RegExp(getDynamoSeedConstants().defaultSpaceId));
    await page.getByLabel("Sign in code").type(oneTimePassword);
    await expect(page).toHaveURL(new RegExp(getDynamoSeedConstants().defaultSpaceId));
});
