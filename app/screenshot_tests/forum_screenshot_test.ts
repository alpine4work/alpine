import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotFileEntity} from "~/app/screenshot_tests/helpers/screenshot_file_entity.js";
import {uploadScreenshotTestFixtureFile} from "~/app/screenshot_tests/helpers/upload_screenshot_test_fixture_file.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateChronologicalIdWithTime} from "~/shared/id/chronological_id.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {PostDraftId, PostId} from "~/shared/id/types/id_types.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {services} = runner;
    const {space, accounts} = await runner.createDemoSpace(context);
    const tokenAgent = services.getAppServiceTokenAgent();

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

    const channelPath = `/s/${space.id}/channels/${channel.id}`;
    const postPath = `/s/${space.id}/posts/${codeBlockPost.id}`;

    await runner.goto(accounts.cassCade, channelPath);
    await expandPostComments(runner, signInPost.id, "Reads more human");
    await runner.screenshot("a0", "channel");

    await channel.access.grantUrl(accounts.cassCade);

    await runner.goto(null, channelPath);
    await expandPostComments(runner, signInPost.id, "Reads more human");
    await runner.screenshot("a1", "channel-url-grant");

    await screenshotFileEntity(runner, accounts.cassCade, "a1", "a2", `Channel:${channel.id}`);

    await runner.goto(accounts.cassCade, channelPath, {
        peekPath: `/s/${space.id}/channels/${channel.id}/files`,
    });
    await runner.screenshot("a2", "channel-files");

    await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
        peekPath: `/s/${space.id}/channels/new`,
    });
    await runner.screenshot("a3", "channel-new");

    await runner.goto(accounts.cassCade, postPath);
    await runner.getByText("Hover-reveal is cleaner").waitFor();
    await runner.screenshot("a4", "post");

    await runner.goto(null, postPath);
    await runner.getByText("Hover-reveal is cleaner").waitFor();
    await runner.screenshot("a5", "post-url-grant");

    await screenshotFileEntity(runner, accounts.cassCade, "a5", "a6", `Post:${codeBlockPost.id}`);

    await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
        peekPath: `/s/${space.id}/posts/new/${postDraftId}`,
    });
    await runner.screenshot("a6", "post-new");
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
