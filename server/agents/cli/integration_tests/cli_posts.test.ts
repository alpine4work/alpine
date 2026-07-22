/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const cli = setupCliForTest();

test("add a post comment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const channel = await TestChannel.create(cli.session, {name: "Launch Updates"});
    const post = await channel.createPost(aliceSession, "YouTube evidence review", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });
    await post.sendMessage(aliceSession, "The initial review is ready.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    expect(await cli.run("alpine search 'YouTube evidence review'")).toEqual(`\
1. [in Launch Updates: YouTube evidence review](/post/in-launch-updates-youtube-evidence-review)

   in Launch Updates: **YouTube** **evidence** **review**

2. [Alice: The initial **review** is ready.](/post-comment/alice-the-initial-review-is-ready)
`);

    expect(await cli.run("alpine read /post/in-launch-updates-youtube-evidence-review")).toEqual(`\
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

    const updateOutput = await cli.run(`\
alpine update /post/in-launch-updates-youtube-evidence-review --old 'End of comments.' --new '<comment>

I reviewed the launch evidence.

</comment>

End of comments.'
`);

    const newComment = await post._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect({
        updateOutput,
        text: newComment.payload.content.doc.textContent,
    }).toEqual({
        updateOutput: "Update was successful.\n",
        text: "I reviewed the launch evidence.",
    });
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

    await cli.run("alpine search 'Post attachment source'");
    expect(await cli.run("alpine read /document/post-attachment-source")).toEqual(`\
# Post attachment source

The source image is available below.

![](/file/image.png)
`);

    expect(await cli.run("alpine search 'YouTube attachment review'")).toEqual(`\
1. [in Evidence Updates: YouTube attachment review](/post/in-evidence-updates-youtube-attachment-review)

   in Evidence Updates: **YouTube** **attachment** **review**

2. [Post attachment source](/document/post-attachment-source)

   The source image is available below.
`);

    expect(await cli.run("alpine read /post/in-evidence-updates-youtube-attachment-review"))
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

    const updateOutput = await cli.run(`\
alpine update /post/in-evidence-updates-youtube-attachment-review --old 'End of comments.' --new '<comment>

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.'
`);
    assert(updateOutput === "Update was successful.\n", updateOutput);

    const newComment = await post._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect({
        updateOutput,
        text: newComment.payload.content.doc.textContent,
        files: newComment.payload.files.map(commentFile =>
            commentFile.type === "File"
                ? {type: commentFile.type, id: commentFile.file.id}
                : commentFile,
        ),
    }).toEqual({
        updateOutput: "Update was successful.\n",
        text: "I attached the image to this follow-up.",
        files: [{type: "File", id: file.id}],
    });
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
            `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await cli.run("alpine search 'YouTube post pagination'");

    expect(
        await cli.run(
            "alpine read '/post/in-launch-updates-youtube-post-pagination?start' --limit=1kb",
        ),
    ).toEqual(`\
Post in [Launch Updates](/channel/launch-updates). [Next page »](/post/in-launch-updates-youtube-post-pagination?after=3)

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
            "alpine read '/post/in-launch-updates-youtube-post-pagination?after=3' --limit=1kb",
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
});
