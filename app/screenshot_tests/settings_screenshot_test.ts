import {expect} from "@playwright/test";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {seedScreenshotTestBots} from "~/app/screenshot_tests/helpers/seed_screenshot_test_bots.js";
import {
    chatGptKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotOwnerEntity} from "~/shared/bots/owners/bot_owner_entity.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

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
        installBotInSpace(accounts.cassCade.action(), {
            spaceId: space.id,
            botId: chatGptKnownBotId,
        }),
        installBotInSpace(accounts.cassCade.action(), {
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

    await runner.goto(accounts.cassCade, `/bot/new/${space.id}`);
    await runner.getByLabel("Name").fill("Standup Buddy");
    // Move the mouse away so the share switch doesn't show a hover state.
    await runner.mouse.move(0, 0);
    await runner.screenshot("b00", "bot-create");

    // Seed the custom bots instead of submitting the create form so they get stable
    // `BotId`s. A custom bot with no uploaded avatar falls back to a default avatar
    // design derived from its `BotId` (see `getAvatarDefaultDesign()`), so a bot
    // created through the form would draw a different avatar on every run.
    const standupBuddyBot = await createCustomBotForScreenshot(context, runner, {
        key: "standupBuddyBot",
        name: "Standup Buddy",
        spaceId: space.id,
        creator: accounts.cassCade,
        ownerEntity: {type: "Account", accountId: accounts.cassCade.account.id},
    });

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots/${standupBuddyBot.id}`);
    await runner.getByRole("button", {name: "Delete bot"}).waitFor();

    // Populate the API keys section by creating a key. The optimistic row uses the
    // client's fixed test clock, so its "Created" date stays deterministic.
    await runner.getByText("Create new API key").click();
    await runner.getByRole("button", {name: "Revoke"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b01", "bot-custom");

    // Create a second custom bot, this one owned by the space instead of the account,
    // so the bot list shows both a personal and a shared custom bot.
    await runner.goto(accounts.cassCade, `/bot/new/${space.id}`);
    // The demo space is named "Alpine" so this picks the space-owned bot option.
    // Select the owner before typing the name so the name input keeps focus, matching
    // "b00".
    await runner.getByText("Shared with Alpine").click();
    await runner.getByLabel("Name").fill("Release Radar");
    await runner.mouse.move(0, 0);
    await runner.screenshot("b02", "bot-create-shared");

    const releaseRadarBot = await createCustomBotForScreenshot(context, runner, {
        key: "releaseRadarBot",
        name: "Release Radar",
        spaceId: space.id,
        creator: accounts.cassCade,
        ownerEntity: {type: "Space", spaceId: space.id},
    });

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots/${releaseRadarBot.id}`);
    await runner.getByRole("button", {name: "Delete bot"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b03", "bot-custom-shared");

    await runner.goto(accounts.cassCade, `/settings/${space.id}/bots`);
    await runner.screenshot("b04", "bots-custom");
}

/**
 * Creates a custom bot with a stable `BotId` and installs it in the space so it
 * shows up on the bots settings pages.
 */
async function createCustomBotForScreenshot(
    context: TestActualContext,
    runner: ScreenshotTestRunner,
    {
        key,
        name,
        spaceId,
        creator,
        ownerEntity,
    }: {
        key: string;
        name: string;
        spaceId: SpaceId;
        creator: TestSpaceSession;
        ownerEntity: BotOwnerEntity;
    },
) {
    const bot = await TestBot.create(context, {
        id: unsafelyGenerateStableId<BotId>(runner.stableRandom, key),
        name,
        webhookUrl: null,
        ownerEntity,
    });

    await installBotInSpace(creator.action(), {
        spaceId,
        botId: bot.id,
        accountId: unsafelyGenerateStableId<AccountId>(runner.stableRandom, `${key}Account`),
    });

    // Installing a bot enqueues background jobs. Drain them before the caller
    // navigates so the bots settings pages, which read from an eventually consistent
    // index, always see the new bot.
    await runner.drainBackgroundWork();

    return bot;
}
