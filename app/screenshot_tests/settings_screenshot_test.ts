import {expect} from "@playwright/test";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {seedScreenshotTestBots} from "~/app/screenshot_tests/helpers/seed_screenshot_test_bots.js";
import {
    chatGptKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    await seedScreenshotTestBots(context, runner.services);

    const {space, accounts} = await runner.createDemoSpace(context);

    await runner.goto(accounts.cassCade, `/settings/${space.id}/profile`);
    await runner.screenshot("a0", "profile");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/notifications`);
    await expect(
        runner.getByRole("switch", {name: "Receive web push notifications"}),
    ).not.toBeChecked();
    await runner.screenshot("a1", "notifications");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/general`);
    await runner.screenshot("a2", "general");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/people`);
    await runner.screenshot("a3", "people");

    await runner.getByRole("button", {name: "Invite"}).click();
    await runner.getByText("These email addresses will be sent a link").waitFor();
    await runner.screenshot("a4", "invite-modal");

    await runAllPromises([
        instantiateBotSpaceAccount(accounts.cassCade.action(), {
            spaceId: space.id,
            botId: chatGptKnownBotId,
        }),
        instantiateBotSpaceAccount(accounts.cassCade.action(), {
            spaceId: space.id,
            botId: cursorKnownBotId,
        }),
    ]);

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots`);
    await runner.screenshot("a5", "bots");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots/${chatGptKnownBotId}`);
    await runner.screenshot("a6", "bot-chatgpt");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots/${cursorKnownBotId}`);
    await runner.screenshot("a7", "bot-cursor");

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}?purchased=lifetime-access`);
    await runner.screenshot("a8", "purchased-lifetime-access-modal");
}
