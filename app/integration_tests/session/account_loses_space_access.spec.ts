import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InternalError} from "~/shared/error/error.open_source.js";

const {context, services} = createTestServices();

test("account can lose access to space", async ({page, context: browserContext}) => {
    const space1 = await TestSpace.create(context, {name: "Test Space 1"});
    const space2 = await TestSpace.create(context, {name: "Test Space 2"});

    const session1 = await space1.createSession({role: "Admin"});
    const session2 = await space1.createSession();

    await space2.addAccount(session1);
    await space2.addAccount(session2);

    const document = await TestDocument.create(session1, {body: "foobar"});
    await document.access.grantDefault(session1);

    await services.signIn(browserContext, session2);
    await page.goto(`/doc/${document.id}`);

    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("You don\u2019t have access to this space")).toBeHidden();
    await expect(page.getByText("Switch space")).toBeHidden();

    await removeSpaceAccount(session1.action(), {
        spaceId: space1.id,
        accountId: session2.account.id,
    });

    // Immediately clear space account cache or else `AppService` will continue to
    // consider the account authorized.
    //
    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch(
        `${services.getBaseUrl()}/api/internal/test/clearSpaceAccountsCache`,
    );
    if (!response.ok) {
        throw new InternalError(
            `Clearing space account cache failed with HTTP status ${response.status}`,
        );
    }

    await page.reload();

    await expect(page.getByText("You don\u2019t have access to this space")).toBeVisible();
    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("Switch space")).toBeHidden();

    await page.getByText("switching spaces").click();

    await expect(page.getByText("Switch space")).toBeVisible();
    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("You don\u2019t have access to this space")).toBeHidden();

    await expect(page.getByText("Test Space 2")).toBeVisible();
    await expect(page.getByText("Test Space 1")).toBeHidden();
});
