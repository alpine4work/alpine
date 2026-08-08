import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotFileEntity} from "~/app/screenshot_tests/helpers/screenshot_file_entity.js";
import {scrollLocatorToBottom} from "~/app/screenshot_tests/helpers/scroll_locator_to_bottom.js";
import {uploadScreenshotTestFixtureFile} from "~/app/screenshot_tests/helpers/upload_screenshot_test_fixture_file.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateChronologicalIdWithTime} from "~/shared/id/chronological_id.open_source.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {PostDraftId, PostId} from "~/shared/id/types/id_types.open_source.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {services} = runner;
    const {space, accounts} = await runner.createDemoSpace(context);
    const tokenAgent = services.getAppServiceTokenAgent();

    // Create the loading channel in the background while doing all our other
    // screenshot work since it may take a while.
    const loadingChannelPromise = (async () => {
        const loadingChannel = await TestChannel.create(accounts.masonClay, {
            name: "Lorem Ipsum",
            access: "Private",
            description: "Dolor sit amet",
        });

        const loadingTimeBase = new Date("2025-10-14T15:24:00.000Z");

        for (let index = 0; index < 20; index++) {
            await loadingChannel.createPost(
                accounts.masonClay,
                `Lorem ipsum dolor sit amet ${index + 1}`,
                {
                    overrideCreatedTime: new Date(loadingTimeBase.getTime() + index),
                },
            );
        }

        return loadingChannel;
    })();

    // Create a channel whose only purpose is to reliably put a subtle notification in
    // Cass Cade's inbox so the inbox button definitely renders with a subtle
    // notification badge. (Instead of relying on our setup code below to consistently
    // create at least one subtle notification.)
    {
        const notificationChannel = await TestChannel.create(accounts.roseCompas);
        await notificationChannel.subscribe(accounts.cassCade);
        await notificationChannel.createPost(accounts.roseCompas);
        await ProcessContextModule.waitForTestTasks();
        await services.waitForSqsProcessJobs();
    }

    const channel = await TestChannel.create(accounts.mattRHorn, {
        name: "Craft",
        description: markdown`
Where we sweat the small stuff. Spacing, motion, hover states, copy that reads a beat off,
animations that feel cheap, empty states that say the wrong thing. If something in the product is
bugging you and it\u2019s smaller than a feature, post it here.
        `,
        access: "Public",
    });

    const [file1, file2, file3, file4, file5, file6] = await runAllPromises([
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_1.jpg",
        ),
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_2.jpg",
        ),
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_3.jpg",
        ),
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_4.jpg",
        ),
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_6.jpg",
        ),
        // Intentionally swapped the order of file 5 and 6 to vary the aspect ratios in the
        // channel files screenshot.
        uploadScreenshotTestFixtureFile(
            tokenAgent,
            accounts.mattRHorn,
            "fictional_ambrook_unsplash_inspiration_5.jpg",
        ),
    ]);

    const filesPost = await channel.createPost(
        accounts.mattRHorn,
        markdown`
Was supposed to be reading a book this weekend and instead spent four hours in a rabbit hole on
small farm cottages in mountain environments. I think these are some good vibes we should
incorporate into our brand.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "filesPost"),
            files: [file1, file2, file3, file4, file5, file6],
            overrideCreatedTime: new Date("2025-09-10T14:38:00.000Z"),
        },
    );

    await channel.createPost(
        accounts.roseCompas,
        markdown`
Small thing: our empty states are pretty boring right now. Instead we should use the space for
education. e.g. prompt the user to create something.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "emptyStatesPost"),
            overrideCreatedTime: new Date("2025-09-24T14:18:00.000Z"),
        },
    );

    const codeBlockPost = await channel.createPost(
        accounts.masonClay,
        markdown`
While I was testing tables I kept playing with our code block UI and I want to revisit it. Right now
the copy button only shows up on hover. It\u2019s clean when you\u2019re reading but every time I
want to copy I have to remember the button is even there and aim my mouse at the right corner.

Two questions for the channel:

1. Should the copy button be always-visible?
2. If yes, where does it sit so it doesn\u2019t fight with the language label?

Proposal: copy button is always-visible in the top-right corner. Move the language label to
top-left. Copy is an action people use _a lot_ for shareable code snippets (which is basically every
doc in our engineering wiki).

One edge case I still need to handle: three code blocks in a row in a table. This layout is pretty
dense and ends up looking visually busy. Maybe in this case we keep the hide-by-default
visible-on-hover behavior? Or icon + \u201CCopy\u201D only when the block is wide enough, and fall
back to icon-only on narrow blocks. Both options keep the control discoverable in the common case
without making the UI overly busy in the dense table edge case.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "codeBlockPost"),
            overrideCreatedTime: new Date("2025-10-03T14:12:00.000Z"),
        },
    );

    const signInPost = await channel.createPost(
        accounts.hollyEvergreen,
        markdown`
Should we use \u201CSign in\u201D or \u201CLog in\u201D on the marketing site? I\u2019m rewriting
the homepage CTA and I\u2019m seeing both in different places. Want to standardize before I push.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "signInPost"),
            overrideCreatedTime: new Date("2025-10-14T15:08:00.000Z"),
        },
    );

    await codeBlockPost.sendMessage(
        accounts.mattRHorn,
        markdown`
I\u2019ve been on the fence on this for a year. Hover-reveal is cleaner visually but the cost (as
you mention) is discoverability. Half the customers I\u2019ve talked to in research didn\u2019t
realize we _had_ a copy button.
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:31:00.000Z")},
    );
    await codeBlockPost.sendMessage(
        accounts.elleKappaTan,
        markdown`
+1 always visible. also the hover thing is straight up broken on touch devices
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:48:00.000Z")},
    );
    const shippedComment = await codeBlockPost.sendMessage(
        accounts.masonClay,
        markdown`
shipped. landed in production this morning
        `,
        {overrideCreatedTime: new Date("2025-10-04T16:30:00.000Z")},
    );
    const signInComment = await signInPost.sendMessage(
        accounts.mattRHorn,
        markdown`
Sign in. Reads more human. When have you ever been asked to \u201Clog in\u201D to an in person event
but if you\u2019ve gone to an event you\u2019ve definitely been asked to \u201Csign in\u201D.
        `,
        {overrideCreatedTime: new Date("2025-10-14T15:24:00.000Z")},
    );

    // Make sure these three are at the end of the contributors list for the channel.
    await filesPost.createComment(accounts.roseCompas, "Test comment 1");
    await filesPost.createComment(accounts.cassCade, "Test comment 2");
    await filesPost.createComment(accounts.cliffWeathers, "Test comment 3");

    await codeBlockPost.setReaction(accounts.mattRHorn, "Yes");
    await codeBlockPost.setReaction(accounts.elleKappaTan, "Yes");
    await codeBlockPost.setReaction(accounts.cassCade, "ThankYou");
    await codeBlockPost.setReaction(accounts.cliffWeathers, "Celebrate");

    await signInComment.setReaction(accounts.hollyEvergreen, "ThankYou");

    await shippedComment.setReaction(accounts.mattRHorn, "Celebrate");
    await shippedComment.setReaction(accounts.elleKappaTan, "Celebrate");

    const postDraftId = generateChronologicalIdWithTime<PostDraftId>(
        new Date("2025-10-14T17:20:00.000Z").getTime(),
    );

    const channelPath = `/channel/${channel.id}`;
    const postPath = `/post/${codeBlockPost.id}`;

    await runner.goto(accounts.cassCade, channelPath);
    await runner.screenshot("a0", "channel");

    await expandPostComments(runner, signInPost.id, "Reads more human");
    await runner.screenshot("a0G", "channel-with-expanded-post-comments");

    await runner.goto(accounts.cassCade, channelPath);
    await expandPostContent(runner, codeBlockPost.id, "dense table edge case");
    await runner.screenshot("a0V", "channel-with-expanded-post-content");

    await expandPostComments(runner, signInPost.id, "Reads more human");
    await runner.screenshot("a0l", "channel-with-expanded-post-comments-and-expanded-post-content");

    await channel.access.grantUrl(accounts.cassCade);

    await runner.goto(null, channelPath);
    await runner.screenshot("a1", "channel-url-grant");

    const oldChannelAccessPolicy = await channel.access.get();
    assert(oldChannelAccessPolicy.type === "Local");

    // Screenshot the channel standalone and inside a site (showing the site
    // breadcrumb). Reuses the existing "Craft" channel; `screenshotFileEntity` adds it
    // to the site, screenshots, then removes it.
    const designSite = await TestSite.create(accounts.mattRHorn, {
        name: "Design",
        access: "Public",
    });
    await screenshotFileEntity(runner, accounts.cassCade, "a1", "a2", `Channel:${channel.id}`, {
        siteOptions: {
            site: designSite,
            revertAccessPolicy: () =>
                channel.access.set(accounts.mattRHorn, oldChannelAccessPolicy),
        },
    });

    await runner.goto(accounts.cassCade, channelPath, {
        peekPath: `/channel/${channel.id}/files`,
    });
    await runner.screenshot("a2", "channel-files");

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        peekPath: `/channel/new/${space.id}`,
    });
    await runner.screenshot("a3", "channel-new");

    await runner.goto(accounts.cassCade, postPath);
    await runner.getByText("Hover-reveal is cleaner").waitFor();
    await runner.screenshot("a4", "post");

    await runner.goto(null, postPath);
    await runner.getByText("Hover-reveal is cleaner").waitFor();
    await runner.screenshot("a5", "post-url-grant");

    // Posts live in a channel, not directly in a site, so there's no in-site variant.
    await screenshotFileEntity(runner, accounts.cassCade, "a5", "a6", `Post:${codeBlockPost.id}`, {
        siteOptions: null,
    });

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        peekPath: `/post/new/${postDraftId}/${space.id}`,
    });
    await runner.screenshot("a6", "post-new");

    {
        const loadingChannel = await loadingChannelPromise;

        await runner.goto(accounts.masonClay, `/channel/${loadingChannel.id}`, {
            allowPauseNetwork: true,
        });
        await runner.pauseNetwork();
        await scrollLocatorToBottom(runner.getByTestId("PostListScrollView"), {
            withExpectedScrollHeightChange: true,
        });
        await runner.screenshot("a7", "channel-loading");
    }

    // Screenshot a desktop peek of a channel both standalone and as part of a site, so
    // we can compare the site breadcrumb chip directly. Uses a dedicated channel
    // (separate from the "Craft" channel above) so the site framing doesn't affect
    // earlier screenshots.
    {
        const oldChannelAccessPolicy = await channel.access.get();
        assert(oldChannelAccessPolicy.type === "Local");

        // Open the peek against `/dev/empty` so the background is plain and the screenshot
        // focuses on the channel peek under test.
        await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
            peekPath: channelPath,
        });
        await runner.getByText("Craft").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a8", "channel-peek");

        // Double click the channel name to open the inline name editor. Wait for the
        // editor input to take focus so the focus ring and text selection are visible.
        await runner.getByTestId("PeekStackOverlay").getByText("Craft").dblclick();
        await runner.getByPlaceholder("Craft").and(runner.page.locator(":focus")).waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a8E1", "channel-peek-name-editor");

        // Replace the name then click away. Losing focus asks for confirmation instead of
        // saving silently.
        await runner.getByPlaceholder("Craft").fill("Lorem ipsum");
        await runner.getByTestId("PostListScrollView").first().click();
        await runner.getByText("Save channel name").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a8E3", "channel-peek-name-editor-confirm-save");

        // Discard the new name so the rest of the screenshots see the original name.
        await runner.getByRole("button", {name: "Discard name"}).click();
        await runner.getByTestId("PeekStackOverlay").getByText("Craft").waitFor();

        await runner
            .getByTestId("PostListScrollView")
            .first()
            .evaluate(element => {
                element.scrollTop = 400;
            });
        await runner.mouse.move(0, 0);
        await runner.screenshot("a8S", "channel-peek-scrolled");

        const goToMarketSite = await TestSite.create(accounts.mattRHorn, {
            name: "Design",
            access: "Public",
        });
        await goToMarketSite.addEntity(accounts.mattRHorn, {
            entityId: `Channel:${channel.id}`,
            parentId: goToMarketSite.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        await ProcessContextModule.waitForTestTasks();
        await services.waitForSqsProcessJobs();

        await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
            peekPath: channelPath,
        });
        await runner.getByText("Craft").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a9", "channel-peek-in-site");

        // Double click the channel name to open the inline name editor. Wait for the
        // editor input to take focus so the focus ring and text selection are visible.
        await runner.getByTestId("PeekStackOverlay").getByText("Craft").dblclick();
        await runner.getByPlaceholder("Craft").and(runner.page.locator(":focus")).waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a9E1", "channel-peek-in-site-name-editor");

        // Replace the name then click away. Losing focus asks for confirmation instead of
        // saving silently.
        await runner.getByPlaceholder("Craft").fill("Lorem ipsum");
        await runner.getByTestId("PostListScrollView").first().click();
        await runner.getByText("Save channel name").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("a9E3", "channel-peek-in-site-name-editor-confirm-save");

        // Discard the new name so the rest of the screenshots see the original name.
        await runner.getByRole("button", {name: "Discard name"}).click();
        await runner.getByTestId("PeekStackOverlay").getByText("Craft").waitFor();

        // Same peek, scrolled — verifies the grown nav bar (chip stacked above the channel
        // name + bottom-aligned Subscribe / ⋮) holds while posts scroll past.
        await runner
            .getByTestId("PostListScrollView")
            .first()
            .evaluate(element => {
                element.scrollTop = 400;
            });
        await runner.mouse.move(0, 0);
        await runner.screenshot("aA", "channel-peek-in-site-scrolled");

        await goToMarketSite.removeEntity(accounts.mattRHorn, `Channel:${channel.id}`);
        await channel.access.set(accounts.mattRHorn, oldChannelAccessPolicy);
    }
}

async function expandPostComments(
    runner: ScreenshotTestRunner,
    postId: string,
    expectedCommentText: string,
) {
    await runner.page
        .getByTestId(`PostContentViewFooter:${postId}`)
        .getByRole("button", {name: "1 comment"})
        .click();
    await runner.getByText(expectedCommentText).waitFor();
    await runner.mouse.move(0, 0);
}

async function expandPostContent(
    runner: ScreenshotTestRunner,
    postId: string,
    expectedPostText: string,
) {
    await runner.page.getByTestId(`PostContentView:${postId}`).getByText("See more").click();
    await runner.getByText(expectedPostText).waitFor();
    await runner.mouse.move(0, 0);
}
