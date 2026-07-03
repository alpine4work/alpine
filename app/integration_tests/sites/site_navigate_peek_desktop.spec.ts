import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";

const {context, services} = createTestServices();

test("expanding a site navigate peek opens the focused entity with site chrome", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const site = await TestSite.create(session, {name: "FY2026 H2 Planning", access: "Public"});
    const channel = await TestChannel.create(session, {
        name: "Status",
        access: {
            type: "Site",
            siteId: site.id,
            position: {parentId: site.initialRootContainerId, orderKey: initialOrderKey},
        },
    });
    // A post so the channel detail has content that only renders inside the channel —
    // not in the `navigate` tree — giving us a clean signal for which view is showing.
    await channel.createPost(session, "Weekly planning status update for the team.");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);

    // Open the channel in a peek over a blank background.
    await page.goto(`/dev/empty/${space.id}?peek=${encodeURIComponent(`/channel/${channel.id}`)}`);
    await page.waitForFunction("dev.ready");

    const peek = page.getByTestId("PeekStackOverlay");

    // The narrow peek shows the channel along with its site breadcrumb chip.
    await expect(peek.getByText("Weekly planning status update for the team.")).toBeVisible();
    const chip = peek.getByRole("button", {name: "FY2026 H2 Planning"});
    await expect(chip).toBeVisible();

    // Tapping the chip opens the site `navigate` route within the same peek: the
    // channel detail is replaced by the in-order site tree.
    await chip.click();

    const navigateView = peek.getByTestId("SiteNavigateView");
    await expect(navigateView).toBeVisible();
    await expect(peek.getByText("Weekly planning status update for the team.")).toBeHidden();
    // The tree lists the channel as an entry.
    await expect(navigateView.getByText("Status", {exact: true})).toBeVisible();

    // Expanding the `navigate` peek lands on the channel's wide route — NOT the bare
    // site tree — because the peek is focused on the channel.
    await page.getByRole("button", {name: "Expand"}).click();

    await expect(peek).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/channel/${channel.id}`));

    // The channel content renders...
    await expect(page.getByText("Weekly planning status update for the team.")).toBeVisible();
    // ...wrapped in site chrome. In a wide layout there's no breadcrumb chip, so the
    // site name only appears in the sidebar — its presence confirms the chrome
    // rendered.
    await expect(page.getByText("FY2026 H2 Planning")).toBeVisible();
});
