/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const cli = setupCliForTest();

test("create channel", async () => {
    expect(
        await cli.run(`\
alpine create channel '# YouTube launch updates

Updates from the launch team.'
`),
    ).toEqual(`\
Create was successful. New channel: [YouTube launch updates](/channel/youtube-launch-updates).
`);
});

test("read channel created by the CLI", async () => {
    expect(
        await cli.run(`\
alpine create channel '# YouTube channel overview

Updates from the launch team.'
`),
    ).toEqual(`\
Create was successful. New channel: [YouTube channel overview](/channel/youtube-channel-overview).
`);

    expect(await cli.run("alpine read /channel/youtube-channel-overview")).toEqual(`\
# YouTube channel overview

Updates from the launch team.

---

End of posts.
`);
});

test("create and read a post without initial comments or an explicit timezone", async () => {
    expect(
        await cli.run(`\
alpine create channel '# Minimal Posts

Posts with a minimal starting state.'
`),
    ).toEqual(`\
Create was successful. New channel: [Minimal Posts](/channel/minimal-posts).
`);

    expect(
        await cli.run(`\
alpine create post 'Post in [Minimal Posts](/channel/minimal-posts).

<post from="[My Bot](/bot/my-bot)">

YouTube baseline post.

</post>'
`),
    ).toEqual(`\
Create was successful. New post: [My in Minimal Posts: YouTube baseline post](/post/my-in-minimal-posts-youtube-baseline-post).
`);

    expect(
        (await cli.run("alpine read /post/my-in-minimal-posts-youtube-baseline-post")).replace(
            /^<time>.*<\/time>$/m,
            "<time>Created recently</time>",
        ),
    ).toEqual(`\
Post in [Minimal Posts](/channel/minimal-posts).

<time>Created recently</time>

<post from="[My](/bot/my-bot)">

YouTube baseline post.

</post>
`);
});

test("create and read a post with initial comments and explicit timezones", async () => {
    expect(
        await cli.run(`\
alpine create channel '# Commented Posts

Posts that begin with a discussion.'
`),
    ).toEqual(`\
Create was successful. New channel: [Commented Posts](/channel/commented-posts).
`);

    expect(
        await cli.run(`\
alpine create post 'Post in [Commented Posts](/channel/commented-posts).

<post timezone="UTC">

# YouTube launch review

Initial evidence is ready.

</post>

<comment id="0" from="[My Bot](/bot/my-bot)">

First launch comment.

</comment>

<comment id="1" timezone="UTC">

Second launch comment.

</comment>

End of comments.'
`),
    ).toEqual(`\
Create was successful. New post: [My in Commented Posts: YouTube launch review](/post/my-in-commented-posts-youtube-launch-review).
`);

    expect(
        (await cli.run("alpine read /post/my-in-commented-posts-youtube-launch-review")).replace(
            /^<time>.*<\/time>$/m,
            "<time>Created recently</time>",
        ),
    ).toEqual(`\
Post in [Commented Posts](/channel/commented-posts).

<time>Created recently</time>

<post from="[My](/bot/my-bot)" timezone="UTC">

## YouTube launch review

Initial evidence is ready.

</post>

<comment id="0" from="[My](/bot/my-bot)">

First launch comment.

</comment>

<comment id="1" from="[My](/bot/my-bot)">

Second launch comment.

</comment>

End of comments.
`);
});

test("create channel from stdin with a divider in the description", async () => {
    expect(
        await cli.run(`printf '%s' '# YouTube launch notes

Before the divider.

<hr />

After the divider.

---' | alpine create channel -`),
    ).toEqual(`\
Create was successful. New channel: [YouTube launch notes](/channel/youtube-launch-notes).
`);

    expect(await cli.run("alpine read /channel/youtube-launch-notes")).toEqual(`\
# YouTube launch notes

Before the divider.

<hr />

After the divider.

---

End of posts.
`);
});

test("update channel name without changing its description", async () => {
    expect(
        await cli.run(`\
alpine create channel '# YouTube channel rename

Old launch description.'
`),
    ).toEqual(`\
Create was successful. New channel: [YouTube channel rename](/channel/youtube-channel-rename).
`);

    expect(await cli.run("alpine read /channel/youtube-channel-rename")).toEqual(`\
# YouTube channel rename

Old launch description.

---

End of posts.
`);

    expect(
        await cli.run(
            "alpine update /channel/youtube-channel-rename --old '# YouTube channel rename' --new '# YouTube product updates'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /channel/youtube-channel-rename")).toEqual(`\
# YouTube product updates

Old launch description.

---

End of posts.
`);
});

test("update channel description without changing its name", async () => {
    expect(
        await cli.run(`\
alpine create channel '# YouTube description update

Old launch description.'
`),
    ).toEqual(`\
Create was successful. New channel: [YouTube description update](/channel/youtube-description-update).
`);

    expect(await cli.run("alpine read /channel/youtube-description-update")).toEqual(`\
# YouTube description update

Old launch description.

---

End of posts.
`);

    expect(
        await cli.run(
            "alpine update /channel/youtube-description-update --old 'Old launch description.' --new 'New product update description.'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /channel/youtube-description-update")).toEqual(`\
# YouTube description update

New product update description.

---

End of posts.
`);
});

test("add a post comment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const channel = await TestChannel.create(cli.session, {name: "Launch Updates"});
    const post = await channel.createPost(aliceSession, "YouTube evidence review", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await post.sendMessage(aliceSession, "The initial review is ready.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    // NOCOMMIT: Yikes! This double post content is not good. We may need to do
    // something special for posts which repeat their title and body.
    expect(await cli.run("alpine search 'YouTube evidence review'")).toEqual(`\
1. [Alice in Launch Updates: **YouTube evidence review**](/post/alice-in-launch-updates-youtube-evidence-review)

   in Launch Updates: **YouTube evidence review**

2. [Alice: The initial **review** is ready.](/post-comment/alice-the-initial-review-is-ready)
`);

    expect(await cli.run("alpine read /post/alice-in-launch-updates-youtube-evidence-review"))
        .toEqual(`\
Post in [Launch Updates](/channel/launch-updates).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

YouTube evidence review

</post>

<comment id="0" from="[Alice](/human/alice)" time="5 minutes later">

The initial review is ready.

</comment>

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /post/alice-in-launch-updates-youtube-evidence-review --old 'End of comments.' --new '<comment>

I reviewed the launch evidence.

</comment>

End of comments.'
`),
    ).toEqual(`\
Update was successful.
`);

    const newComment = await post._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect(newComment.payload.content.doc.textContent).toEqual("I reviewed the launch evidence.");
});

test("read channel posts with comment counts", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const channel = await TestChannel.create(cli.session, {name: "Post Comment Counts"});
    const commentedPost = await channel.createPost(aliceSession, "Commented launch summary", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await commentedPost.sendMessage(aliceSession, "First comment on the launch summary.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });
    await commentedPost.sendMessage(aliceSession, "Second comment on the launch summary.", {
        overrideCreatedTime: new Date("2026-05-14T15:10:00.000Z"),
    });
    await channel.createPost(aliceSession, "Uncommented roadmap summary", {
        overrideCreatedTime: new Date("2026-05-14T15:15:00.000Z"),
    });

    expect(await cli.run("alpine search 'Post Comment Counts'")).toEqual(
        expect.stringContaining("[**Post Comment Counts**](/channel/post-comment-counts)"),
    );

    expect(await cli.run("alpine read /channel/post-comment-counts")).toEqual(`\
# Post Comment Counts

---

<post from="[Alice](/human/alice)" time="May 14th at 11:15am EDT" comments="0">

Uncommented roadmap summary

[See more »](/post/alice-in-post-comment-counts-uncommented-roadma)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="2">

Commented launch summary

[See more »](/post/alice-in-post-comment-counts-commented-launc)

</post>

End of posts.
`);
});

test("read a bot-authored channel post", async () => {
    const releaseBot = await TestBot.createAndInstantiate(cli.session, {
        name: "Release Bot",
    });
    const channel = await TestChannel.create(cli.session, {name: "Bot Posts"});
    await channel.createPost(releaseBot, "Automated release summary", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    expect(await cli.run("alpine search 'Bot Posts'")).toEqual(
        expect.stringContaining("[**Bot Posts**](/channel/bot-posts)"),
    );

    expect(await cli.run("alpine read /channel/bot-posts")).toEqual(`\
# Bot Posts

---

<post from="[Release](/bot/release-bot)" time="May 14th at 11:00am EDT" comments="0">

Automated release summary

[See more »](/post/release-in-bot-posts-automated-release-summary)

</post>

End of posts.
`);
});

test("read the first and tail pages of a paginated channel", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const channel = await TestChannel.create(cli.session, {
        name: "Paged Posts",
        description: "Posts split across two pages.",
    });

    for (let index = 0; index < 4; index++) {
        await channel.createPost(aliceSession, `Page post ${index}.`, {
            overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5)),
        });
    }

    expect(await cli.run("alpine search 'Paged Posts'")).toEqual(
        expect.stringContaining("[**Paged Posts**](/channel/paged-posts)"),
    );

    expect(await cli.run("alpine read /channel/paged-posts --limit=500b")).toEqual(`\
# Paged Posts

Posts split across two pages.

---

[Next page »](/channel/paged-posts?after=2026-05-14T15:10:00.000)

<post from="[Alice](/human/alice)" time="May 14th at 11:15am EDT" comments="0">

Page post 3.

[See more »](/post/alice-in-paged-posts-page-post-3)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:10am EDT" comments="0">

Page post 2.

[See more »](/post/alice-in-paged-posts-page-post-2)

</post>
`);

    expect(
        await cli.run(
            "alpine read '/channel/paged-posts?after=2026-05-14T15:10:00.000' --limit=500b",
        ),
    ).toEqual(`\
Posts in Paged Posts.

<post from="[Alice](/human/alice)" time="May 14th at 11:05am EDT" comments="0">

Page post 1.

[See more »](/post/alice-in-paged-posts-page-post-1)

</post>

<post from="[Alice](/human/alice)" time="May 14th at 11:00am EDT" comments="0">

Page post 0.

[See more »](/post/alice-in-paged-posts-page-post-0)

</post>

End of posts.
`);
});

test("read a post comment reply with a non-default timezone", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const bobSession = await cli.session.space.createSession({name: "Bob"});
    const channel = await TestChannel.create(cli.session, {name: "Reply Reviews"});
    const post = await channel.createPost(aliceSession, "YouTube reply review", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    const parentComment = await post.sendMessage(aliceSession, "Can you review the rollout?", {
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });
    await post.sendMessage(bobSession, "Taking a look now.", {
        parent: parentComment,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        overrideCreatedTime: new Date("2026-05-14T15:10:00.000Z"),
    });

    expect(await cli.run("alpine search 'YouTube reply review'")).toEqual(
        expect.stringContaining(
            "[Alice in **Reply Reviews**: **YouTube reply review**](/post/alice-in-reply-reviews-youtube-reply-review)",
        ),
    );

    expect(await cli.run("alpine read /post/alice-in-reply-reviews-youtube-reply-review"))
        .toEqual(`\
Post in [Reply Reviews](/channel/reply-reviews).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

YouTube reply review

</post>

<comment id="0" from="[Alice](/human/alice)" time="5 minutes later" timezone="PDT">

Can you review the rollout?

</comment>

<comment id="1" from="[Bob](/human/bob)" time="5 minutes later" timezone="PDT">

<blockquote cite="?comment=0">

[Alice](/human/alice): Can you review the rollout?

</blockquote>

Taking a look now.

</comment>

End of comments.
`);
});

test("add a post comment with a file attachment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    // TODO: Remove the source document once agents can upload files through the API.
    // Until then, it gives the agent a path it can use to reference the file.
    const sourceDocument = await TestDocument.create(cli.session, {
        title: "Post attachment source",
        body: "The source image is available below.",
        access: "Public",
    });
    const file = await TestFile.create(cli.session);
    await sourceDocument.attachFile(cli.session, file);

    const channel = await TestChannel.create(cli.session, {name: "Evidence Updates"});
    const post = await channel.createPost(aliceSession, "YouTube attachment review", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await post.sendMessage(aliceSession, "Discussion has started.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    await testTracer.withSpan("Process post attachment source search job", async span => {
        await processIndexSearchEntityJob(
            cli.space.systemAction(),
            {
                type: "IndexSearchEntity",
                spaceId: sourceDocument.space.id,
                update: {
                    type: "Document",
                    documentId: sourceDocument.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
            span,
        );
    });

    expect(await cli.run("alpine search 'Post attachment source'")).toEqual(
        expect.stringContaining("[**Post attachment source**](/document/post-attachment-source)"),
    );
    expect(await cli.run("alpine read /document/post-attachment-source")).toEqual(`\
# Post attachment source

The source image is available below.

![](/file/image.png)
`);

    expect(await cli.run("alpine search 'YouTube attachment review'")).toEqual(`\
1. [Alice in Evidence Updates: **YouTube attachment review**](/post/alice-in-evidence-updates-youtube-attachmen)

   in Evidence Updates: **YouTube attachment review**

2. [Post **attachment** source](/document/post-attachment-source)

   The source image is available below.
`);

    expect(await cli.run("alpine read /post/alice-in-evidence-updates-youtube-attachmen"))
        .toEqual(`\
Post in [Evidence Updates](/channel/evidence-updates).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

YouTube attachment review

</post>

<comment id="0" from="[Alice](/human/alice)" time="5 minutes later">

Discussion has started.

</comment>

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /post/alice-in-evidence-updates-youtube-attachmen --old 'End of comments.' --new '<comment timezone="UTC">

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        (await cli.run("alpine read /post/alice-in-evidence-updates-youtube-attachmen")).replace(
            /^<time>(?!May 14th at 11:00am EDT).*<\/time>$/m,
            "<time>Created recently</time>",
        ),
    ).toEqual(`\
Post in [Evidence Updates](/channel/evidence-updates).

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

YouTube attachment review

</post>

<comment id="0" from="[Alice](/human/alice)" time="5 minutes later">

Discussion has started.

</comment>

<time>Created recently</time>

<comment id="1" from="[My](/bot/my-bot)">

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.
`);

    const newComment = await post._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect(newComment.payload.content.doc.textContent).toEqual(
        "I attached the image to this follow-up.",
    );
    expect(newComment.createdTimeZone).toEqual(assertTimeZone("UTC"));
    expect(
        newComment.payload.files.map(commentFile =>
            commentFile.type === "File"
                ? {type: commentFile.type, id: commentFile.file.id}
                : commentFile,
        ),
    ).toEqual([{type: "File", id: file.id}]);
});

test("paginate post comments", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const channel = await TestChannel.create(cli.session, {name: "Launch Updates"});
    const post = await channel.createPost(aliceSession, "YouTube post pagination", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    for (let index = 0; index < 17; index++) {
        await post.sendMessage(
            aliceSession,
            index === 16
                ? "Solenodon final comment."
                : `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    expect(await cli.run("alpine search 'YouTube post pagination'")).toEqual(
        expect.stringContaining(
            "[Alice in Launch Updates: **YouTube post pagination**](/post/alice-in-launch-updates-youtube-post-pagination)",
        ),
    );

    expect(
        await cli.run(
            "alpine read '/post/alice-in-launch-updates-youtube-post-pagination?start' --limit=1kb",
        ),
    ).toEqual(`\
Post in [Launch Updates](/channel/launch-updates). [Next page »](/post/alice-in-launch-updates-youtube-post-pagination?after=3)

<time>May 14th at 11:00am EDT</time>

<post from="[Alice](/human/alice)">

YouTube post pagination

</post>

<comment id="0" from="[Alice](/human/alice)">

Paginated comment 0. This comment has enough detail to make the response require pagination.

</comment>

<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 1. This comment has enough detail to make the response require pagination.

</comment>

<comment id="2" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 2. This comment has enough detail to make the response require pagination.

</comment>

<comment id="3" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 3. This comment has enough detail to make the response require pagination.

</comment>
`);

    expect(
        await cli.run(
            "alpine read '/post/alice-in-launch-updates-youtube-post-pagination?after=3' --limit=1kb",
        ),
    ).toEqual(`\
Comments on [post](/post/alice-in-launch-updates-youtube-post-pagination). [Next page »](/post/alice-in-launch-updates-youtube-post-pagination?after=7)

<time>May 14th at 11:20am EDT</time>

<comment id="4" from="[Alice](/human/alice)">

Paginated comment 4. This comment has enough detail to make the response require pagination.

</comment>

<comment id="5" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 5. This comment has enough detail to make the response require pagination.

</comment>

<comment id="6" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 6. This comment has enough detail to make the response require pagination.

</comment>

<comment id="7" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 7. This comment has enough detail to make the response require pagination.

</comment>
`);

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** final comment.](/post-comment/alice-solenodon-final-comment)
`);

    expect(await cli.run("alpine read /post-comment/alice-solenodon-final-comment --limit=1kb"))
        .toEqual(`\
Comments on [post](/post/alice-in-launch-updates-youtube-post-pagination). [Previous page »](/post/alice-in-launch-updates-youtube-post-pagination?before=13)

<time>May 14th at 12:05pm EDT</time>

<comment id="13" from="[Alice](/human/alice)">

Paginated comment 13. This comment has enough detail to make the response require pagination.

</comment>

<comment id="14" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 14. This comment has enough detail to make the response require pagination.

</comment>

<comment id="15" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 15. This comment has enough detail to make the response require pagination.

</comment>

<comment id="16" from="[Alice](/human/alice)" time="5 minutes later">

Solenodon final comment.

</comment>

End of comments.
`);

    expect(
        await cli.run(
            "alpine read '/post/alice-in-launch-updates-youtube-post-pagination?before=13' --limit=1kb",
        ),
    ).toEqual(`\
Comments on [post](/post/alice-in-launch-updates-youtube-post-pagination). [Previous page »](/post/alice-in-launch-updates-youtube-post-pagination?before=9)

<time>May 14th at 11:45am EDT</time>

<comment id="9" from="[Alice](/human/alice)">

Paginated comment 9. This comment has enough detail to make the response require pagination.

</comment>

<comment id="10" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 10. This comment has enough detail to make the response require pagination.

</comment>

<comment id="11" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 11. This comment has enough detail to make the response require pagination.

</comment>

<comment id="12" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 12. This comment has enough detail to make the response require pagination.

</comment>
`);
});
