import {Page} from "playwright";
import {
    createDemoSpaceWithoutUploadingAvatars,
    uploadDemoSpaceAvatars,
} from "~/admin/environment/demo_space/create_demo_space.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {createFictionalAmbrookDemoAgents} from "~/admin/scenarios/internal/fictional_ambrook_demo_agents.js";
import {createFictionalAmbrookDemoChannel} from "~/admin/scenarios/internal/fictional_ambrook_demo_channel.js";
import {createFictionalAmbrookDemoChats} from "~/admin/scenarios/internal/fictional_ambrook_demo_chats.js";
import {createFictionalAmbrookDemoDocument} from "~/admin/scenarios/internal/fictional_ambrook_demo_document.js";
import {createFictionalAmbrookDemoFeed} from "~/admin/scenarios/internal/fictional_ambrook_demo_feed.js";
import {createFictionalAmbrookDemoInbox} from "~/admin/scenarios/internal/fictional_ambrook_demo_inbox.js";
import {createFictionalAmbrookHeroFeed} from "~/admin/scenarios/internal/fictional_ambrook_hero_feed.js";
import {createFictionalAmbrookSprintTasks} from "~/admin/scenarios/internal/fictional_ambrook_sprint_tasks.js";
import {createFictionalAmbrookSuggestions} from "~/admin/scenarios/internal/fictional_ambrook_suggestions.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {JsonObjectValue} from "~/shared/helpers/types/json_value.js";
import {Schema} from "~/shared/schema/schema.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

const env = parseDotenv();

const edgeDevPort = assertExists(env.EDGE_DEV_PORT);

export async function createLandingPageScenario(
    context: TestContext,
    {tokenAgent}: {tokenAgent: TokenAgent},
) {
    const {
        space,
        accounts: accountsWithoutChatGpt,
        cassCadeEmailAddress,
        roseCompasEmailAddress,
    } = await createDemoSpaceWithoutUploadingAvatars(context);

    const {cassCade, roseCompas} = accountsWithoutChatGpt;

    const chatGpt = await (async () => {
        // TODO(calebmer, 2025-12-08): We don't currently have bot avatars set up yet.
        // There's a file in `scenario_chatgpt_avatar.png` that we're not currently using.
        // We need to figure out a way to get avatars uploaded for bots for test scenarios.
        const bot = await TestBot.get(space.context, getDynamoSeedConstants().mockChatGptBotId);

        return bot.instantiate(roseCompas);
    })();

    const accounts = {...accountsWithoutChatGpt, chatGpt};

    // Before doing anything else, put a subtle notification in Cass's inbox. That way
    // if we archive any other inbox entries while taking screenshots it won't trigger
    // the "hide subtle notification for 5 minutes after inbox cleared" logic.
    {
        const channel = await TestChannel.create(cassCade, {
            name: "Test",
            access: "Public",
        });

        const post = await channel.createPost(cassCade, "Test");

        await post.sendMessage(roseCompas, "Test");

        // Wait until the inbox entry exists.
        await retryWithExponentialBackoff(async retry => {
            try {
                await getInboxEntry(cassCade.action(), {
                    spaceId: space.id,
                    key: {type: "PostComments", postId: post.id},
                });
            } catch (error) {
                throw retry(error);
            }
        });
    }

    const [
        {sprintCollection},
        demoDocument,
        demoChannel,
        [demoChat1, demoChat2],
        inboxDemoAccount,
        agentsDemoDocument,
        demoFeedEntries,
        heroFeedEntries,
    ] = await runAllPromises([
        createFictionalAmbrookSprintTasks(accounts).then(async sprintTasks => {
            await createFictionalAmbrookSuggestions(accounts, sprintTasks);
            return sprintTasks;
        }),
        createFictionalAmbrookDemoDocument(tokenAgent, accounts),
        createFictionalAmbrookDemoChannel(tokenAgent, accounts),
        createFictionalAmbrookDemoChats(tokenAgent, accounts),
        createFictionalAmbrookDemoInbox(accounts),
        createFictionalAmbrookDemoAgents(accounts),
        createFictionalAmbrookDemoFeed(accounts),
        createFictionalAmbrookHeroFeed(accounts),
        uploadDemoSpaceAvatars(tokenAgent, accounts),
    ]);

    const spaceSideBarWidth = 56;

    const screenshots: Array<{
        skip?: CommitBlocker;
        only?: CommitBlocker;
        debug?: CommitBlocker;
        name: string;
        path: string;
        session?: TestSession;
        viewport: {
            width: number;
            height: number;
        };
        clip?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        initScript?: string;
        prepare?: (page: Page) => Promise<void>;
    }> = [
        (() => {
            const width = 1344;
            const height = 840;
            const scale = 1.15;
            const clipRight = 60;

            const url = new UrlPath(`/s/${space.id}/dev/feed`);
            url.searchParams.set(
                "entries",
                JSON.stringify(Schema.array(FeedEntrySchema).serialize(heroFeedEntries)),
            );

            return {
                name: "hero",
                path: url.toString(),
                viewport: {
                    width: Math.round(width * scale) + clipRight,
                    height: Math.round(height * scale),
                },
                clip: {
                    x: 0,
                    y: 0,
                    width: Math.round(width * scale),
                    height: Math.round(height * scale),
                },
                prepare: async page => {
                    // Hide the space side bar navigation buttons.
                    await page.evaluate("dev.spaceSideBar.toggleNavigationButtonsVisibility()");
                },
            };
        })(),
        (() => {
            const path = new UrlPath(`/s/${space.id}/tasks/collections/${sprintCollection.id}`);

            path.searchParams.set(
                "filter",
                serializeTaskQueryFiltersSearchParam([
                    {
                        type: "DisplayStatus",
                        operation: {
                            type: "OneOf",
                            displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                        },
                    },
                ]),
            );

            path.searchParams.set(
                "sort",
                serializeTaskQuerySortsSearchParam([
                    {type: "Assignee", missing: "First"},
                    {type: "DisplayStatus", direction: "Descending"},
                    {type: "Priority", direction: "Descending"},
                ]),
            );

            const scale = 1.1;
            const height = Math.round(710 * scale);
            const width = Math.round(height * (4 / 3));

            return {
                name: "tasks_demo",
                path: path.toString(),
                viewport: {
                    width: width + spaceSideBarWidth,
                    height,
                },
                clip: {
                    x: spaceSideBarWidth,
                    y: 0,
                    width,
                    height,
                },
                prepare: async page => {
                    await page.evaluate("dev.taskFloatingCreateButton.toggleVisibility()");
                },
            };
        })(),
        (() => {
            return {
                name: "documents_demo",
                path: `/s/${space.id}/documents/${demoDocument.id}`,
                viewport: {
                    width: 780,
                    height: 1118,
                },

                // Note card aspect ratio. We want our file entity previews to be short so we can
                // show more of the photo gallery below the table.
                initScript: `window.__fileEntityPreviewSmallAspectRatio = 5 / 3`,

                prepare: async page => {
                    // Hide the space side bar. We can't clip it out since the document content is
                    // centered within the viewport.
                    await page.evaluate("dev.spaceSideBar.toggleVisibility()");

                    // Blobs aren't drawn in integration tests by default because they cause CI to be
                    // flaky, so draw them here for the screenshot.
                    await page.evaluate("__actuallyDrawBlobsForIntegrationTest()");

                    // Wait for all images to load.
                    await page.waitForLoadState("networkidle");
                },
            };
        })(),
        (() => {
            const height = 712;
            const width = 948;
            const scale = 1.4;

            return {
                name: "forum_demo",
                path: `/s/${space.id}/channels/${demoChannel.id}`,
                viewport: {
                    width: Math.round(width * scale),
                    height: Math.round(height * scale),
                },
                prepare: async page => {
                    // Hide the space side bar.
                    await page.evaluate("dev.spaceSideBar.toggleVisibility()");

                    // Open the comment section for the second post.
                    await page.getByRole("button", {name: "1 comment"}).click();

                    // Move the mouse so it's not hovering the comment section button anymore.
                    await page.mouse.move(0, 0);

                    // Wait for comments to load.
                    await page.waitForLoadState("networkidle");
                },
            };
        })(),
        (() => {
            const width = 900;
            const height = 900;
            const peekRightOffset = 48;
            const peekNarrowLayoutWidth = 512;
            const peekMaxHeight = 672;
            const peekControlsHeight = 24;

            return {
                name: "chat_demo_1",
                path: `/s/${space.id}/dev/empty?link=${encodeURIComponent(
                    `/s/${space.id}/chat/${demoChat1.id}`,
                )}`,
                viewport: {
                    width,
                    height,
                },
                clip: {
                    x: width - peekRightOffset - peekNarrowLayoutWidth,
                    width: peekNarrowLayoutWidth,
                    y: height - peekMaxHeight + peekControlsHeight,
                    height: peekMaxHeight - peekControlsHeight,
                },
                prepare: async page => {
                    // Open the chat peek
                    await page.getByRole("link", {name: "Link"}).click();

                    // Wait for the chat peek to open
                    const messageLocator = page.getByTestId(`MessageView:${demoChat1.id}:5`);
                    await (await messageLocator.elementHandle())!.waitForElementState("stable");

                    // Select the text to reply to
                    await messageLocator.getByText("ideas for what project").evaluate(element => {
                        const selection = globalThis.window.getSelection()!;

                        const range = globalThis.document.createRange();
                        range.setStart(element.firstChild!, 22);
                        range.setEnd(element.firstChild!, 60);

                        selection.removeAllRanges();
                        selection.addRange(range);
                    });

                    // Set the selected text as what we're replying to
                    await page.getByText("Reply").click();

                    // Move the mouse out of the way so we don't show a hover state on the reply
                    // button.
                    await page.mouse.move(0, 0);

                    // Wait for the reply input to be visible
                    await page.getByTestId("MessageInputParent").waitFor({state: "visible"});

                    // Wait for the message input to be focused
                    await page.waitForFunction("document.activeElement");

                    // Select the text again so the reply button is in the screenshot
                    await messageLocator.getByText("ideas for what project").evaluate(element => {
                        (globalThis.document.activeElement as HTMLElement).blur();

                        const selection = globalThis.window.getSelection()!;

                        const range = globalThis.document.createRange();
                        range.setStart(element.firstChild!, 22);
                        range.setEnd(element.firstChild!, 60);

                        selection.removeAllRanges();
                        selection.addRange(range);
                    });

                    // Wait for the reply button to animate in and be visible
                    const replyLocator = page.getByText("Reply");
                    await (await replyLocator.elementHandle())!.waitForElementState("stable");

                    // Wait for the scrollbar to disappear. The scrollbar is hidden 1.2s after scroll
                    // then has a 200ms fade out animation. Wait 3 seconds to be safe.
                    await wait(3000);
                },
            };
        })(),
        (() => {
            const width = 900;
            const height = 900;
            const peekRightOffset = 48;
            const peekNarrowLayoutWidth = 512;
            const peekMaxHeight = 672;
            const peekControlsHeight = 24;

            return {
                name: "chat_demo_2",
                path: `/s/${space.id}/dev/empty?link=${encodeURIComponent(
                    `/s/${space.id}/chat/${demoChat2.id}`,
                )}`,
                viewport: {
                    width,
                    height,
                },
                clip: {
                    x: width - peekRightOffset - peekNarrowLayoutWidth,
                    width: peekNarrowLayoutWidth,
                    y: height - peekMaxHeight + peekControlsHeight,
                    height: peekMaxHeight - peekControlsHeight,
                },
                prepare: async page => {
                    // Open the chat peek
                    await page.getByRole("link", {name: "Link"}).click();

                    // Wait for the chat peek to open
                    const messageLocator = page.getByTestId(`MessageView:${demoChat2.id}:1`);
                    await (await messageLocator.elementHandle())!.waitForElementState("stable");
                },
            };
        })(),
        (() => {
            const scale = 1.5;
            const width = Math.round(740 * scale);
            const height = Math.round(580 * scale);

            return {
                name: "inbox_demo",
                path: `/s/${space.id}/inbox`,
                session: inboxDemoAccount,
                viewport: {
                    width: width + spaceSideBarWidth + 1,
                    height,
                },
                clip: {
                    // We add 1px because there's a 1px border between the space layout sidebar and
                    // inbox entries we want to clip out of the screenshot.
                    x: spaceSideBarWidth + 1,
                    y: 0,
                    width,
                    height,
                },
                prepare: async page => {
                    // Click the inbox entry with new comment threads.
                    await page.getByText("Q2 Product Roadmap").click();

                    // Move the mouse so we don't show any hover states.
                    await page.mouse.move(0, 0);

                    // Hide times on inbox entries because it'll all be the same time which wouldn’t
                    // make sense.
                    await page.evaluate("dev.inbox.toggleEntryTimeVisibility()");

                    // Wait for the inbox entry we clicked to load.
                    await page.waitForLoadState("networkidle");
                },
            };
        })(),
        (() => {
            const scale = 1.5;
            const width = Math.round(740 * scale);
            const height = Math.round(580 * scale);
            const searchModalMaxWidth = 896;
            const searchModalMaxHeight = 704;

            return {
                name: "search_demo",
                path: `/s/${space.id}/dev/empty`,
                viewport: {
                    width,
                    height,
                },
                clip: {
                    x: (width - searchModalMaxWidth) / 2 + 1,
                    y: (height - searchModalMaxHeight) / 2 + 1,
                    width: searchModalMaxWidth - 2,
                    height: searchModalMaxHeight - 2,
                },
                prepare: async page => {
                    // Open the search modal.
                    await page.getByRole("button", {name: "Search"}).click();

                    // Open the sprint task collection for viewing in the search modal's preview.
                    await page.getByText("Sprint (2026 Q2)").click();

                    // Wait for the task collection to load.
                    await page
                        .getByTestId(/^TaskRowView:/)
                        .first()
                        .waitFor({state: "visible"});

                    // Turn off the search modal's border radius so the search modal corners don't show
                    // up in the screenshot.
                    await page.evaluate("dev.searchModal.toggleBorderRadius()");
                },
            };
        })(),
        (() => {
            const scale = 1.3;
            const width = Math.round(740 * scale);
            const height = Math.round(580 * scale);

            return {
                name: "agents_demo",
                path: `/s/${space.id}/documents/${agentsDemoDocument.id}`,
                viewport: {
                    width: width + spaceSideBarWidth,
                    height,
                },
                clip: {
                    x: spaceSideBarWidth,
                    y: 0,
                    width,
                    height,
                },
                prepare: async page => {
                    // Open the create menu.
                    await page.getByRole("button", {name: "Create"}).click();

                    // Create a new message.
                    await page.getByRole("menuitem", {name: "Message"}).click();

                    // Select ChatGPT as who you're sending a message to.
                    await page.getByRole("option", {name: "ChatGPT"}).click();

                    // Wait for the scrollbar to disappear. The scrollbar is hidden 1.2s after scroll
                    // then has a 200ms fade out animation. Wait 3 seconds to be safe.
                    await wait(3000);
                },
            };
        })(),
        (() => {
            const scale = 1.25;
            const width = Math.round(740 * scale);
            const height = Math.round(580 * scale);
            const feedCreateSectionTranslateY = 144 - 24;

            const url = new UrlPath(`/s/${space.id}/dev/feed`);
            url.searchParams.set(
                "entries",
                JSON.stringify(Schema.array(FeedEntrySchema).serialize(demoFeedEntries)),
            );

            return {
                name: "feed_demo",
                path: url.toString(),
                viewport: {
                    width: width + spaceSideBarWidth,
                    height: height + feedCreateSectionTranslateY,
                },
                clip: {
                    x: spaceSideBarWidth,
                    y: feedCreateSectionTranslateY,
                    width,
                    height,
                },
                prepare: async page => {
                    await page.evaluate("dev.feed.toggleLeftSideBarVisibility()");

                    // Blobs aren't drawn in integration tests by default because they cause CI to be
                    // flaky, so draw them here for the screenshot.
                    await page.evaluate("__actuallyDrawBlobsForIntegrationTest()");
                },
            };
        })(),
    ];

    return {
        space,
        cassCade,
        screenshots,
        log: cast<JsonObjectValue>({
            spaceId: space.id,
            cassCade: {
                accountId: cassCade.account.id,
                emailAddress: cassCadeEmailAddress,
            },
            roseCompas: {
                accountId: roseCompas.account.id,
                emailAddress: roseCompasEmailAddress,
            },
            screenshots: Object.fromEntries(
                screenshots.map(screenshot => [
                    screenshot.name,
                    `http://localhost:${edgeDevPort}${screenshot.path}`,
                ]),
            ),
        }),
    };
}
