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

test("create an active task assigned to another account", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(
        await cli.run(`\
alpine create task '# Prepare active launch

- Status: Open (Active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Create was successful. New task: [Prepare active launch](/task/prepare-active-launch).
`);

    expect(await cli.run("alpine read /task/prepare-active-launch")).toEqual(`\
# Prepare active launch

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
`);
});

test("activate a task already assigned to another account", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(
        await cli.run(`\
alpine create task '# Activate existing assignment

- Status: Open
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Create was successful. New task: [Activate existing assignment](/task/activate-existing-assignment).
`);

    expect(
        await cli.run(
            "alpine update /task/activate-existing-assignment --old '- Status: Open' --new '- Status: Open (Active)'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-existing-assignment")).toEqual(`\
# Activate existing assignment

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
`);
});

test("activate and assign a task to another account in the same update", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    await cli.run("alpine create task '# Activate and assign'");

    expect(
        await cli.run(`\
alpine update /task/activate-and-assign \\
  --old '# Activate and assign' \\
  --new '# Activate and assign

- Status: Open (Active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-and-assign")).toEqual(`\
# Activate and assign

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
`);
});

test("activate and reassign a task to another account in the same update", async () => {
    await cli.session.space.createSession({name: "Alice"});
    await cli.session.space.createSession({name: "Bob"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine search Bob")).toEqual(`\
1. [Bob](/human/bob)

2. [My Bot](/bot/my-bot)
`);

    await cli.run(`\
alpine create task '# Activate and assign

- Assignee: [Bob](/human/bob)'
`);

    expect(
        await cli.run(`\
alpine update /task/activate-and-assign \\
  --old '- Assignee: [Bob](/human/bob)' \\
  --new '- Status: Open (Active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-and-assign")).toEqual(`\
# Activate and assign

- Status: Open (Active)
- Assignee: [Alice](/human/alice)
`);
});

test("reject a task collection cursor reused with different sorts", async () => {
    await cli.run(`\
alpine create task-collection '# Cursor sort roadmap

- Cursor task 01 (Open)
- Cursor task 02 (Open)
- Cursor task 03 (Open)
- Cursor task 04 (Open)
- Cursor task 05 (Open)
- Cursor task 06 (Open)
- Cursor task 07 (Open)
- Cursor task 08 (Open)'
`);

    const nextPagePath = (
        await cli.run(`\
page="$(alpine read /task-collection/cursor-sort-roadmap --limit 160b)"
printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }'
`)
    ).trim();

    expect(await cli.run(`alpine read '${nextPagePath}&sort=-created'`)).toEqual(`\
Error: Couldn\u2019t read \`${nextPagePath}&sort=-created\`. Invalid task query cursor for this collection. Try again with a task query cursor that matches the requested sorts. (You may get this error if you\u2019re paginating through a task collection when the task collection\u2019s default sorts change. In that case try paginating from the start of the collection again and you\u2019ll pick up the new sorts.)
`);
});

test("reject a task collection cursor after its default sorts change", async () => {
    const collection = await TestTaskCollection.create(cli.session, {
        name: "Changing default sorts roadmap",
        access: "Public",
    });
    await collection.updateDefaults(cli.session, {
        filters: [],
        sorts: [{type: "CreatedTime", direction: "Descending"}],
    });

    await TestTask.create(cli.session, {
        title: "Changing default sorts task 01",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 02",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 03",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 04",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 05",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 06",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 07",
        collections: collection,
    });
    await TestTask.create(cli.session, {
        title: "Changing default sorts task 08",
        collections: collection,
    });

    expect(await cli.run("alpine search 'Changing default sorts roadmap'")).toEqual(`\
1. [Changing default sorts roadmap](/task-collection/changing-default-sorts-roadmap)
`);

    const nextPagePath = (
        await cli.run(`\
page="$(alpine read /task-collection/changing-default-sorts-roadmap --limit 240b)"
printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }'
`)
    ).trim();

    await collection.updateDefaults(cli.session, {
        filters: [],
        sorts: [{type: "CreatedTime", direction: "Ascending"}],
    });

    expect(await cli.run(`alpine read '${nextPagePath}'`)).toEqual(`\
Error: Couldn’t read \`${nextPagePath}\`. Invalid task query cursor for this collection. Try again with a task query cursor that matches the requested sorts. (You may get this error if you’re paginating through a task collection when the task collection’s default sorts change. In that case try paginating from the start of the collection again and you’ll pick up the new sorts.)
`);
});

test("shuffle task collection tasks and observe the order with a fresh read", async () => {
    await cli.run(`\
alpine create task-collection '# Shuffle roadmap

- Shuffle alpha (Open)
- Shuffle bravo (Open)
- Shuffle charlie (Open)
- Shuffle delta (Open)'
`);

    expect(
        await cli.run(`\
alpine update /task-collection/shuffle-roadmap \\
  --old '- Shuffle alpha (Open)
- Shuffle bravo (Open)
- Shuffle charlie (Open)
- Shuffle delta (Open)' \\
  --new '- Shuffle charlie (Open)
- Shuffle alpha (Open)
- Shuffle delta (Open)
- Shuffle bravo (Open)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/shuffle-roadmap")).toEqual(`\
# Shuffle roadmap

- [Shuffle charlie (Open)](/task/shuffle-charlie)

- [Shuffle alpha (Open)](/task/shuffle-alpha)

- [Shuffle delta (Open)](/task/shuffle-delta)

- [Shuffle bravo (Open)](/task/shuffle-bravo)

End of tasks.
`);
});

test("shuffle linked task collection tasks and observe the order with a fresh read", async () => {
    await cli.run(`\
alpine create task-collection '# Linked shuffle roadmap

- Linked shuffle alpha (Open)
- Linked shuffle bravo (Open)
- Linked shuffle charlie (Open)
- Linked shuffle delta (Open)'
`);

    expect(await cli.run("alpine read /task-collection/linked-shuffle-roadmap")).toEqual(`\
# Linked shuffle roadmap

- [Linked shuffle alpha (Open)](/task/linked-shuffle-alpha)

- [Linked shuffle bravo (Open)](/task/linked-shuffle-bravo)

- [Linked shuffle charlie (Open)](/task/linked-shuffle-charlie)

- [Linked shuffle delta (Open)](/task/linked-shuffle-delta)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task-collection/linked-shuffle-roadmap \\
  --old '- [Linked shuffle alpha (Open)](/task/linked-shuffle-alpha)

- [Linked shuffle bravo (Open)](/task/linked-shuffle-bravo)

- [Linked shuffle charlie (Open)](/task/linked-shuffle-charlie)

- [Linked shuffle delta (Open)](/task/linked-shuffle-delta)' \\
  --new '- [Linked shuffle charlie (Open)](/task/linked-shuffle-charlie)

- [Linked shuffle alpha (Open)](/task/linked-shuffle-alpha)

- [Linked shuffle delta (Open)](/task/linked-shuffle-delta)

- [Linked shuffle bravo (Open)](/task/linked-shuffle-bravo)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/linked-shuffle-roadmap")).toEqual(`\
# Linked shuffle roadmap

- [Linked shuffle charlie (Open)](/task/linked-shuffle-charlie)

- [Linked shuffle alpha (Open)](/task/linked-shuffle-alpha)

- [Linked shuffle delta (Open)](/task/linked-shuffle-delta)

- [Linked shuffle bravo (Open)](/task/linked-shuffle-bravo)

End of tasks.
`);
});

test("move and add task collection tasks in the same update", async () => {
    await cli.run(`\
alpine create task-collection '# Move and add roadmap

- Move add alpha (Open)
- Move add bravo (Open)
- Move add charlie (Open)'
`);

    expect(
        await cli.run(`\
alpine update /task-collection/move-and-add-roadmap \\
  --old '- Move add alpha (Open)
- Move add bravo (Open)
- Move add charlie (Open)' \\
  --new '- Move add charlie (Open)
- Move add new task (Open)
- Move add alpha (Open)
- Move add bravo (Open)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/move-and-add-roadmap")).toEqual(`\
# Move and add roadmap

- [Move add charlie (Open)](/task/move-add-charlie)

- [Move add new task (Open)](/task/move-add-new-task)

- [Move add alpha (Open)](/task/move-add-alpha)

- [Move add bravo (Open)](/task/move-add-bravo)

End of tasks.
`);
});

test("move task collection tasks in successive updates", async () => {
    await cli.run(`\
alpine create task-collection '# Successive moves roadmap

- Successive alpha (Open)
- Successive bravo (Open)
- Successive charlie (Open)
- Successive delta (Open)'
`);

    expect(
        await cli.run(`\
alpine update /task-collection/successive-moves-roadmap \\
  --old '- Successive alpha (Open)
- Successive bravo (Open)
- Successive charlie (Open)
- Successive delta (Open)' \\
  --new '- Successive delta (Open)
- Successive alpha (Open)
- Successive bravo (Open)
- Successive charlie (Open)'

alpine update /task-collection/successive-moves-roadmap \\
  --old '- Successive delta (Open)
- Successive alpha (Open)
- Successive bravo (Open)
- Successive charlie (Open)' \\
  --new '- Successive delta (Open)
- Successive charlie (Open)
- Successive alpha (Open)
- Successive bravo (Open)'
`),
    ).toEqual(`\
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/successive-moves-roadmap")).toEqual(`\
# Successive moves roadmap

- [Successive delta (Open)](/task/successive-delta)

- [Successive charlie (Open)](/task/successive-charlie)

- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)

End of tasks.
`);
});

test("activate an embedded task already assigned to another account", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    await cli.run(`\
alpine create task-collection '# Embedded existing roadmap

- Embedded existing task (Open)
  - Assignee: [Alice](/human/alice)'
`);

    expect(
        await cli.run(
            "alpine update /task-collection/embedded-existing-roadmap --old 'Embedded existing task (Open)' --new 'Embedded existing task (Open, active)'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/embedded-existing-roadmap")).toEqual(`\
# Embedded existing roadmap

- [Embedded existing task (Open, active)](/task/embedded-existing-task)
  - Assignee: [Alice](/human/alice)

End of tasks.
`);
});

test("activate and assign an embedded task in the same update", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    await cli.run(`\
alpine create task-collection '# Embedded assignment roadmap

- Embedded assignment task (Open)'
`);

    expect(
        await cli.run(`\
alpine update /task-collection/embedded-assignment-roadmap \\
  --old '- Embedded assignment task (Open)' \\
  --new '- Embedded assignment task (Open, active)
  - Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/embedded-assignment-roadmap")).toEqual(`\
# Embedded assignment roadmap

- [Embedded assignment task (Open, active)](/task/embedded-assignment-task)
  - Assignee: [Alice](/human/alice)

End of tasks.
`);
});

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
