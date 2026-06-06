import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

async function markPageBeforeSpaceSwitch(page: Page) {
    await page.evaluate(() => {
        (window as Window & {spaceSwitcherTestMarker?: string}).spaceSwitcherTestMarker =
            "before-switch";
    });
}

async function expectFullPageSpaceSwitch(page: Page, spaceId: string) {
    await expect(page).toHaveURL(new RegExp(`/home/${spaceId}(?:[?#]|$)`));
    await expect
        .poll(() =>
            page.evaluate(() => {
                return (window as Window & {spaceSwitcherTestMarker?: string})
                    .spaceSwitcherTestMarker;
            }),
        )
        .toBeUndefined();
}

async function switchSpacesFromDesktopSideBar(page: Page, spaceName: string) {
    await page.getByLabel("Space").click();
    await page.getByRole("menuitem", {name: "Switch space"}).hover();
    await page.getByRole("menuitem", {name: spaceName}).click();
}

async function switchSpacesFromMobileMoreRoute({
    page,
    currentSpaceId,
    spaceName,
}: {
    page: Page;
    currentSpaceId: string;
    spaceName: string;
}) {
    await page.getByLabel("More").click();
    await page.getByText("Switch", {exact: true}).click();

    await expect(page).toHaveURL(new RegExp(`/more/switch-space/${currentSpaceId}(?:[?#]|$)`));

    const spaceRowLocator = page.getByText(spaceName, {exact: true});
    await expect(spaceRowLocator).toBeVisible();
    await spaceRowLocator.click();
}

test("can switch spaces", async ({page, context: browserContext, isMobile}) => {
    const firstSpaceName = "First Space";
    const secondSpaceName = "Second Space";
    const firstSpace = await TestSpace.create(context, {name: firstSpaceName});
    const secondSpace = await TestSpace.create(context, {name: secondSpaceName});
    const session = await firstSpace.createSession({role: "Owner"});
    await secondSpace.addAccount(session, "Owner");

    await services.signIn(browserContext, session);
    await page.goto(`/home/${firstSpace.id}`);
    await markPageBeforeSpaceSwitch(page);

    if (isMobile) {
        await switchSpacesFromMobileMoreRoute({
            page,
            currentSpaceId: firstSpace.id,
            spaceName: secondSpaceName,
        });
    } else {
        await switchSpacesFromDesktopSideBar(page, secondSpaceName);
    }

    await expectFullPageSpaceSwitch(page, secondSpace.id);

    if (isMobile) {
        await page.getByLabel("More").click();
        await expect(page.getByText(secondSpaceName, {exact: true})).toBeVisible();
    } else {
        await page.getByLabel("Space").click();
        await expect(
            page.getByRole("menu").getByText(secondSpaceName, {exact: true}),
        ).toBeVisible();
    }
});
