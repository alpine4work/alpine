import {CalendarDateTime, today} from "@internationalized/date";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {uploadScenarioFile} from "~/admin/scenarios/internal/upload_scenario_file.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {PostContentProsemirrorSchema} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoChannel(
    tokenAgent: TokenAgent,
    {
        cassCade,
        mattRHorn,
        roseCompas,
        cliffWeathers,
        masonClay,
        chatGpt,
        hollyEvergreen,
        elleKappaTan,
    }: DemoSpaceAccounts & {
        chatGpt: TestBotAccount;
    },
) {
    debug("Creating channel");

    const {space} = cassCade;

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const baseTime = new CalendarDateTime(currentDate.year, 5, 22, 9);

    const collection = await TestTaskCollection.create(cliffWeathers, {
        name: "Social Content Calendar",
        access: "Public",
    });

    await collection.updateColor(cliffWeathers, "purple");

    const collectionPromise = (async () => {
        await runAllPromises([
            TestTask.create(cliffWeathers, {
                title: "60-second field demo reel of mobile scanner OCR",
                collections: [collection],
            }),
            TestTask.create(cliffWeathers, {
                title: "Customer quotes carousel",
                collections: [collection],
            }),
            TestTask.create(cliffWeathers, {
                title: "Launch post for receipt mobile scanner",
                collections: [collection],
            }),
            TestTask.create(cliffWeathers, {
                title: "\u201CGrants your operation might be missing\u201D blog post",
                collections: [collection],
            }),
        ]);

        debug("Created post preview task collection");

        return collection;
    })();

    // Make sure if an error is thrown we wait for the task collection promise to
    // resolve before destroying the context.
    cassCade.context.process.waitUntil(collectionPromise);

    const channel = await TestChannel.create(cassCade, {
        name: "Marketing",
        access: "Public",
        description: Mustache.render(
            markdown`
📣 Brainstorm and share ideas for outreach, social content, campaigns, and growth. Everything from
big-picture strategy to post drafts lives here.

Refer to [Social Content Calendar](https://alpine.inc/tasks/{{collectionId}}?mention) for the
current plan.
            `,
            {
                spaceId: space.id,
                collectionId: collection.id,
            },
        ),
    });

    // The button looks better unsubscribed in the demo screenshot.
    await channel.unsubscribe(cassCade);

    let lastPost;
    {
        const post = await channel.createPost(roseCompas, "Blah blah blah.", {
            overrideCreatedTime: baseTime
                .subtract({days: 1})
                .add({hours: 2, minutes: 17})
                .toDate(timeZone),
        });

        lastPost = post;
    }

    const filesPromise = (async () => {
        const files = await runAllPromises([
            uploadScenarioFile(
                tokenAgent,
                roseCompas,
                "fictional_ambrook_unsplash_inspiration_6.jpg",
                {type: "Post", postId: lastPost.id},
            ),
            uploadScenarioFile(
                tokenAgent,
                roseCompas,
                "fictional_ambrook_unsplash_inspiration_7.jpg",
                {type: "Post", postId: lastPost.id},
            ),
            uploadScenarioFile(
                tokenAgent,
                roseCompas,
                "fictional_ambrook_unsplash_inspiration_8.jpg",
                {type: "Post", postId: lastPost.id},
            ),
            uploadScenarioFile(
                tokenAgent,
                roseCompas,
                "fictional_ambrook_unsplash_inspiration_9.jpg",
                {type: "Post", postId: lastPost.id},
            ),
            uploadScenarioFile(
                tokenAgent,
                roseCompas,
                "fictional_ambrook_unsplash_inspiration_1.jpg",
                {type: "Post", postId: lastPost.id},
            ),
        ]);

        debug("Uploaded channel files");

        return files;
    })();

    // Make sure if an error is thrown we wait for the task collection promise to
    // resolve before destroying the context.
    cassCade.context.process.waitUntil(filesPromise);

    {
        const schema = PostContentProsemirrorSchema;

        const collection = await collectionPromise;

        const post = await channel.createPost(
            cliffWeathers,
            schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("I updated our content calendar task collection for June:"),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: `TaskCollection:${collection.id}`}),
                ]),
            ]),
            {
                overrideCreatedTime: baseTime
                    .subtract({days: 1})
                    .add({hours: 6, minutes: 5})
                    .toDate(timeZone),
            },
        );

        await post.setReaction(masonClay, "Heart");
        await post.setReaction(mattRHorn, "ThankYou");

        await post.createComment(
            cassCade,
            "Thanks, I added some customers we have publicity rights for to the carousel task",
            {
                overrideCreatedTime: baseTime
                    .subtract({days: 1})
                    .add({hours: 6, minutes: 6})
                    .toDate(timeZone),
            },
        );
    }

    {
        const post = await channel.createPost(
            mattRHorn,
            markdown`
Our first foray into podcast advertising is going great! We\u2019re seeing a lot more sign ups than
we expected coming from the campaign\u2019s vanity URLs. What are some of the podcasts y\u2019all
listen to that you think we should buy ad spots on next month?
            `,
            {
                overrideCreatedTime: baseTime.add({hours: 1, minutes: 21}).toDate(timeZone),
            },
        );

        await post.setReaction(cassCade, "Happy");
        await post.setReaction(elleKappaTan, "Yes");
        await post.setReaction(roseCompas, "Celebrate");
        await post.setReaction(hollyEvergreen, "Celebrate");

        await post.createComment(cassCade, "Blah blah blah");
        await post.createComment(masonClay, "Blah blah blah");
        await post.createComment(chatGpt, "Blah blah blah");

        // Juice the comment count number
        for (let i = 0; i < 39; i++) {
            await post.createComment(roseCompas, "Blah blah blah");
        }
    }

    // Get everyone in the people account avatar pile.
    await lastPost.createComment(hollyEvergreen, "Blah blah blah");
    await lastPost.createComment(elleKappaTan, "Blah blah blah");

    const [file1, file2, file3, file4, file5] = await filesPromise;

    // The files in the last post aren't visible. They only show up in the "files"
    // section of the sidebar.
    {
        const schema = PostContentProsemirrorSchema;

        await lastPost.updateContent(
            roseCompas,
            schema.node("doc", {}, [
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1.id}),
                    schema.node("file", {fileId: file2.id}),
                ]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file3.id}),
                    schema.node("file", {fileId: file4.id}),
                    schema.node("file", {fileId: file5.id}),
                ]),
            ]),
        );
    }

    debug("Created channel");

    return channel;
}
