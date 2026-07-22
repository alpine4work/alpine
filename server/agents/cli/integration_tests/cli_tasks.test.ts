/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const cli = setupCliForTest();

test("add a task comment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const collection = await TestTaskCollection.create(cli.session, {
        name: "Launch Tasks",
        access: "Public",
    });
    const task = await TestTask.create(cli.session, {
        title: "YouTube evidence review",
        assignee: cli.session,
        assigneeStatus: "Active",
        collections: collection,
    });
    await task.createComment(aliceSession, "Solenodon initial task comment.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** initial task comment.](/task-comment/alice-solenodon-initial-task-comment)
`);

    expect(await cli.run("alpine read /task-comment/alice-solenodon-initial-task-comment"))
        .toEqual(`\
Comments on [YouTube evidence review (Open, active)](/task/youtube-evidence-review).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Solenodon initial task comment.

</comment>

End of comments.
`);

    const updateOutput = await cli.run(`\
alpine update /task-comment/alice-solenodon-initial-task-comment --old 'End of comments.' --new '<comment>

I reviewed the launch evidence.

</comment>

End of comments.'
`);

    const newComment = await task._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect({
        updateOutput,
        text: newComment.payload.content.doc.textContent,
    }).toEqual({
        updateOutput: "Update was successful.\n",
        text: "I reviewed the launch evidence.",
    });
});

test("add a task comment with a file attachment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    // TODO: Remove the source document once agents can upload files through the API.
    // Until then, it gives the agent a path it can use to reference the file.
    const sourceDocument = await TestDocument.create(cli.session, {
        title: "Task attachment source",
        body: "The source image is available below.",
        access: "Public",
    });
    const file = await TestFile.create(cli.session);
    await sourceDocument.attachFile(cli.session, file);

    const collection = await TestTaskCollection.create(cli.session, {
        name: "Evidence Tasks",
        access: "Public",
    });
    const task = await TestTask.create(cli.session, {
        title: "YouTube attachment review",
        assignee: cli.session,
        assigneeStatus: "Active",
        collections: collection,
    });
    await task.createComment(aliceSession, "Xylophone source discussion.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    await testTracer.withSpan("Process task attachment source search job", async span => {
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

    await cli.run("alpine search 'Task attachment source'");
    expect(await cli.run("alpine read /document/task-attachment-source")).toEqual(`\
# Task attachment source

The source image is available below.

![](/file/image.png)
`);

    expect(await cli.run("alpine search xylophone")).toEqual(`\
1. [Alice: **Xylophone** source discussion.](/task-comment/alice-xylophone-source-discussion)
`);

    expect(await cli.run("alpine read /task-comment/alice-xylophone-source-discussion")).toEqual(`\
Comments on [YouTube attachment review (Open, active)](/task/youtube-attachment-review).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Xylophone source discussion.

</comment>

End of comments.
`);

    const updateOutput = await cli.run(`\
alpine update /task-comment/alice-xylophone-source-discussion --old 'End of comments.' --new '<comment>

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.'
`);
    assert(updateOutput === "Update was successful.\n", updateOutput);

    const newComment = await task._getMessage(cli.session.action(), 1);
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

test("paginate task comments", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const collection = await TestTaskCollection.create(cli.session, {
        name: "Launch Tasks",
        access: "Public",
    });
    const task = await TestTask.create(cli.session, {
        title: "YouTube task pagination",
        assignee: cli.session,
        assigneeStatus: "Active",
        collections: collection,
    });
    await task.createComment(aliceSession, "Solenodon first comment.", {
        overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
    });

    for (let index = 1; index < 17; index++) {
        await task.createComment(
            aliceSession,
            `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await cli.run("alpine search solenodon");

    expect(await cli.run("alpine read /task-comment/alice-solenodon-first-comment --limit=1kb"))
        .toEqual(`\
Comments on [YouTube task pagination (Open, active)](/task/youtube-task-pagination). [Next page »](/task/youtube-task-pagination/comments?after=3)

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Solenodon first comment.

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
        await cli.run("alpine read '/task/youtube-task-pagination/comments?after=3' --limit=1kb"),
    ).toEqual(`\
Comments on [YouTube task pagination (Open, active)](/task/youtube-task-pagination). [Next page »](/task/youtube-task-pagination/comments?after=7)

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
