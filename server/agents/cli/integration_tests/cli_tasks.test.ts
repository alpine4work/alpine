/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
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

- Status: Open (active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Create was successful. New task: [Prepare active launch](/task/prepare-active-launch).
`);

    expect(await cli.run("alpine read /task/prepare-active-launch")).toEqual(`\
# Prepare active launch

- Status: Open (active)
- Assignee: [Alice](/human/alice)
`);
});

test("create and read a task with every field", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine create task '# Launch program'")).toEqual(`\
Create was successful. New task: [Launch program](/task/launch-program).
`);

    expect(
        await cli.run(`\
alpine create task-collection '# Engineering

Color: Blue'
`),
    ).toEqual(`\
Create was successful. New task collection: [Engineering](/task-collection/engineering).
`);

    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

Color: Green'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).
`);

    expect(
        await cli.run(`\
alpine create task '# Ship task page

- Status: Open (active)
- Parent: [Launch program](/task/launch-program)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: July 12th, 2027

## Notes

Read rollout notes.

### Context

Ship behind a flag.

## Subtasks

- Draft launch brief (Open, active)
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering)
  - Priority: High
  - Due date: July 10th, 2027'
`),
    ).toEqual(`\
Create was successful. New task: [Ship task page](/task/ship-task-page).

Also created the following task: [Draft launch brief (Open, active)](/task/draft-launch-brief).
`);

    expect(await cli.run("alpine read /task/ship-task-page")).toEqual(`\
# Ship task page

- Status: Open (active)
- Parent: [Launch program](/task/launch-program)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: July 12th, 2027

## Notes

Read rollout notes.

### Context

Ship behind a flag.

## Subtasks

- [Draft launch brief (Open, active)](/task/draft-launch-brief)
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering)
  - Priority: High
  - Due date: July 10th, 2027
`);

    expect(await cli.run("alpine read /task/ship-task-page/subtasks")).toEqual(`\
Subtasks for [Ship task page (Open, active)](/task/ship-task-page).

- [Draft launch brief (Open, active)](/task/draft-launch-brief)
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering)
  - Priority: High
  - Due date: July 10th, 2027

End of tasks.
`);
});

test("update every task field independently", async () => {
    await cli.session.space.createSession({name: "Alice"});
    await cli.session.space.createSession({name: "Bob"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine search Bob")).toEqual(`\
1. [Bob](/human/bob)

2. [My Bot](/bot/my-bot)
`);

    expect(
        await cli.run(`\
alpine create task '# First parent'
alpine create task '# Second parent'
alpine create task-collection '# First collection'
alpine create task-collection '# Second collection'
alpine create task-collection '# Third collection'
`),
    ).toEqual(`\
Create was successful. New task: [First parent](/task/first-parent).
Create was successful. New task: [Second parent](/task/second-parent).
Create was successful. New task collection: [First collection](/task-collection/first-collection).
Create was successful. New task collection: [Second collection](/task-collection/second-collection).
Create was successful. New task collection: [Third collection](/task-collection/third-collection).
`);

    expect(
        await cli.run(`\
alpine create task '# Initial task

- Status: Open
- Parent: [First parent](/task/first-parent)
- Assignee: [Alice](/human/alice)
- Collections: [First collection](/task-collection/first-collection), [Second collection](/task-collection/second-collection)
- Priority: Low
- Due date: July 10th, 2027

## Notes

Initial notes.'
`),
    ).toEqual(`\
Create was successful. New task: [Initial task](/task/initial-task).
`);

    expect(await cli.run("alpine read /task/initial-task")).toEqual(`\
# Initial task

- Status: Open
- Parent: [First parent](/task/first-parent)
- Assignee: [Alice](/human/alice)
- Collections: [First collection](/task-collection/first-collection), [Second collection](/task-collection/second-collection)
- Priority: Low
- Due date: July 10th, 2027

## Notes

Initial notes.
`);

    expect(
        await cli.run(`\
alpine update /task/initial-task \\
  --old '# Initial task' \\
  --new '# Updated task'
alpine update /task/initial-task \\
  --old '- Parent: [First parent](/task/first-parent)' \\
  --new '- Parent: [Second parent](/task/second-parent)'
alpine update /task/initial-task \\
  --old '- Assignee: [Alice](/human/alice)' \\
  --new '- Assignee: [Bob](/human/bob)'
alpine update /task/initial-task \\
  --old '- Status: Open' \\
  --new '- Status: Closed'
alpine update /task/initial-task \\
  --old '- Collections: [First collection](/task-collection/first-collection), [Second collection](/task-collection/second-collection)' \\
  --new '- Collections: [Second collection](/task-collection/second-collection), [Third collection](/task-collection/third-collection)'
alpine update /task/initial-task \\
  --old '- Priority: Low' \\
  --new '- Priority: High'
alpine update /task/initial-task \\
  --old '- Due date: July 10th, 2027' \\
  --new '- Due date: July 12th, 2027'
alpine update /task/initial-task \\
  --old 'Initial notes.' \\
  --new 'Updated notes.'
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task/initial-task")).toEqual(`\
# Updated task

- Status: Closed
- Parent: [Second parent](/task/second-parent)
- Assignee: [Bob](/human/bob)
- Collections: [Second collection](/task-collection/second-collection), [Third collection](/task-collection/third-collection)
- Priority: High
- Due date: July 12th, 2027

## Notes

Updated notes.
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
            "alpine update /task/activate-existing-assignment --old '- Status: Open' --new '- Status: Open (active)'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-existing-assignment")).toEqual(`\
# Activate existing assignment

- Status: Open (active)
- Assignee: [Alice](/human/alice)
`);
});

test("activate and assign a task to another account in the same update", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine create task '# Activate and assign'")).toEqual(`\
Create was successful. New task: [Activate and assign](/task/activate-and-assign).
`);

    expect(
        await cli.run(`\
alpine update /task/activate-and-assign \\
  --old '# Activate and assign' \\
  --new '# Activate and assign

- Status: Open (active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-and-assign")).toEqual(`\
# Activate and assign

- Status: Open (active)
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

    expect(
        await cli.run(`\
alpine create task '# Activate and assign

- Assignee: [Bob](/human/bob)'
`),
    ).toEqual(`\
Create was successful. New task: [Activate and assign](/task/activate-and-assign).
`);

    expect(
        await cli.run(`\
alpine update /task/activate-and-assign \\
  --old '- Assignee: [Bob](/human/bob)' \\
  --new '- Status: Open (active)
- Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-and-assign")).toEqual(`\
# Activate and assign

- Status: Open (active)
- Assignee: [Alice](/human/alice)
`);
});

test("create and read a task collection with color and every task field", async () => {
    await cli.session.space.createSession({name: "Alice"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(
        await cli.run(`\
alpine create task '# Reference parent'
alpine create task-collection '# Alpha'
alpine create task-collection '# Beta'
alpine create task-collection '# Gamma'
alpine create task-collection '# Delta'
`),
    ).toEqual(`\
Create was successful. New task: [Reference parent](/task/reference-parent).
Create was successful. New task collection: [Alpha](/task-collection/alpha).
Create was successful. New task collection: [Beta](/task-collection/beta).
Create was successful. New task collection: [Gamma](/task-collection/gamma).
Create was successful. New task collection: [Delta](/task-collection/delta).
`);

    expect(
        await cli.run(`\
alpine create task '# Embedded launch task

- Status: Open (active)
- Parent: [Reference parent](/task/reference-parent)
- Assignee: [Alice](/human/alice)
- Collections: [Alpha](/task-collection/alpha), [Beta](/task-collection/beta), [Gamma](/task-collection/gamma), [Delta](/task-collection/delta)
- Priority: Urgent
- Due date: July 12th, 2027

## Subtasks

- Embedded child (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Embedded launch task](/task/embedded-launch-task).

Also created the following task: [Embedded child (Open)](/task/embedded-child).
`);

    expect(
        await cli.run(`\
alpine create task-collection '# Release plan

Color: Blue

- [Embedded launch task (Open, active)](/task/embedded-launch-task)
  - Parent: [Reference parent](/task/reference-parent)
  - Subtasks: 1 open
  - Assignee: [Alice](/human/alice)
  - Collections: [Alpha](/task-collection/alpha), [Beta](/task-collection/beta), [Gamma](/task-collection/gamma), and 1 more
  - Priority: Urgent
  - Due date: July 12th, 2027'
`),
    ).toEqual(`\
Create was successful. New task collection: [Release plan](/task-collection/release-plan).
`);

    expect(await cli.run("alpine read /task-collection/release-plan")).toEqual(`\
# Release plan

Color: Blue

- [Embedded launch task (Open, active)](/task/embedded-launch-task)
  - Parent: [Reference parent](/task/reference-parent)
  - Subtasks: 1 open
  - Assignee: [Alice](/human/alice)
  - Collections: [Alpha](/task-collection/alpha), [Beta](/task-collection/beta), [Gamma](/task-collection/gamma), and 1 more
  - Priority: Urgent
  - Due date: July 12th, 2027

End of tasks.
`);
});

test("reject creating task collection defaults through the unimplemented endpoint", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Filtered create roadmap

Default filters and sorts:

\`\`\`
status=open&sort=-priority,due
\`\`\`'
`),
    ).toEqual(`\
Error: Couldn\u2019t create task collection. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Setting the default filters and sorts while creating a task collection hasn\u2019t been implemented yet
`);
});

test("update every task collection field and embedded task field", async () => {
    await cli.session.space.createSession({name: "Alice"});
    await cli.session.space.createSession({name: "Bob"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine search Bob")).toEqual(`\
1. [Bob](/human/bob)

2. [My Bot](/bot/my-bot)
`);

    expect(
        await cli.run(`\
alpine create task '# First parent'
alpine create task '# Second parent'
alpine create task-collection '# First other collection'
alpine create task-collection '# Second other collection'
`),
    ).toEqual(`\
Create was successful. New task: [First parent](/task/first-parent).
Create was successful. New task: [Second parent](/task/second-parent).
Create was successful. New task collection: [First other collection](/task-collection/first-other-collection).
Create was successful. New task collection: [Second other collection](/task-collection/second-other-collection).
`);

    expect(
        await cli.run(`\
alpine create task-collection '# Mutable roadmap

Color: Red

- Mutable task (Open)
  - Parent: [First parent](/task/first-parent)
  - Assignee: [Alice](/human/alice)
  - Collections: [First other collection](/task-collection/first-other-collection)
  - Priority: Low
  - Due date: July 10th, 2027'
`),
    ).toEqual(`\
Create was successful. New task collection: [Mutable roadmap](/task-collection/mutable-roadmap).

Also created the following task: [Mutable task (Open)](/task/mutable-task).
`);

    expect(await cli.run("alpine read /task-collection/mutable-roadmap")).toEqual(`\
# Mutable roadmap

Color: Red

- [Mutable task (Open)](/task/mutable-task)
  - Parent: [First parent](/task/first-parent)
  - Assignee: [Alice](/human/alice)
  - Collections: [First other collection](/task-collection/first-other-collection)
  - Priority: Low
  - Due date: July 10th, 2027

End of tasks.
`);

    expect(
        await cli.run(`\
alpine create task '# External task

- Priority: Medium'
`),
    ).toEqual(`\
Create was successful. New task: [External task](/task/external-task).
`);

    expect(
        await cli.run(`\
alpine update /task-collection/mutable-roadmap \\
  --old '# Mutable roadmap' \\
  --new '# Updated roadmap'
alpine update /task-collection/mutable-roadmap \\
  --old 'Color: Red' \\
  --new 'Color: Purple'
alpine update /task-collection/mutable-roadmap \\
  --old '[Mutable task (Open)](/task/mutable-task)' \\
  --new '[Renamed task (Open)](/task/mutable-task)'
alpine update /task-collection/mutable-roadmap \\
  --old '- Parent: [First parent](/task/first-parent)' \\
  --new '- Parent: [Second parent](/task/second-parent)'
alpine update /task-collection/mutable-roadmap \\
  --old '- Assignee: [Alice](/human/alice)' \\
  --new '- Assignee: [Bob](/human/bob)'
alpine update /task-collection/mutable-roadmap \\
  --old '[Renamed task (Open)](/task/mutable-task)' \\
  --new '[Renamed task (Open, active)](/task/mutable-task)'
alpine update /task-collection/mutable-roadmap \\
  --old '- Collections: [First other collection](/task-collection/first-other-collection)' \\
  --new '- Collections: [Second other collection](/task-collection/second-other-collection)'
alpine update /task-collection/mutable-roadmap \\
  --old '- Priority: Low' \\
  --new '- Priority: High'
alpine update /task-collection/mutable-roadmap \\
  --old '- Due date: July 10th, 2027' \\
  --new '- Due date: July 12th, 2027'
alpine update /task-collection/mutable-roadmap \\
  --old 'End of tasks.' \\
  --new '- [External task (Open)](/task/external-task)
  - Priority: Medium

End of tasks.'
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/mutable-roadmap")).toEqual(`\
# Updated roadmap

Color: Purple

- [Renamed task (Open, active)](/task/renamed-task)
  - Parent: [Second parent](/task/second-parent)
  - Assignee: [Bob](/human/bob)
  - Collections: [Second other collection](/task-collection/second-other-collection)
  - Priority: High
  - Due date: July 12th, 2027

- [External task (Open)](/task/external-task)
  - Priority: Medium

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task-collection/mutable-roadmap \\
  --old '- [Renamed task (Open, active)](/task/renamed-task)
  - Parent: [Second parent](/task/second-parent)
  - Assignee: [Bob](/human/bob)
  - Collections: [Second other collection](/task-collection/second-other-collection)
  - Priority: High
  - Due date: July 12th, 2027' \\
  --new ''
alpine update /task-collection/mutable-roadmap \\
  --old 'Color: Purple' \\
  --new 'Color: None'
`),
    ).toEqual(`\
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/mutable-roadmap")).toEqual(`\
# Updated roadmap

- [External task (Open)](/task/external-task)
  - Priority: Medium

End of tasks.
`);
});

test("reject a task collection cursor reused with different sorts", async () => {
    expect(
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
`),
    ).toEqual(`\
Create was successful. New task collection: [Cursor sort roadmap](/task-collection/cursor-sort-roadmap).

Also created the following tasks:

- [Cursor task 01 (Open)](/task/cursor-task-01)

- [Cursor task 02 (Open)](/task/cursor-task-02)

- [Cursor task 03 (Open)](/task/cursor-task-03)

- [Cursor task 04 (Open)](/task/cursor-task-04)

- [Cursor task 05 (Open)](/task/cursor-task-05)

- [Cursor task 06 (Open)](/task/cursor-task-06)

- [Cursor task 07 (Open)](/task/cursor-task-07)

- [Cursor task 08 (Open)](/task/cursor-task-08)
`);

    const nextPagePath = (
        await cli.run(`\
page="$(alpine read /task-collection/cursor-sort-roadmap --limit 160b)"
printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }'
`)
    ).trim();
    expect(nextPagePath).toEqual(
        expect.stringContaining("/task-collection/cursor-sort-roadmap?after="),
    );

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
    expect(nextPagePath).toEqual(
        expect.stringContaining("/task-collection/changing-default-sorts-roadmap?after="),
    );

    await collection.updateDefaults(cli.session, {
        filters: [],
        sorts: [{type: "CreatedTime", direction: "Ascending"}],
    });

    expect(await cli.run(`alpine read '${nextPagePath}'`)).toEqual(`\
Error: Couldn’t read \`${nextPagePath}\`. Invalid task query cursor for this collection. Try again with a task query cursor that matches the requested sorts. (You may get this error if you’re paginating through a task collection when the task collection’s default sorts change. In that case try paginating from the start of the collection again and you’ll pick up the new sorts.)
`);
});

test("read task collection default filters and sorts", async () => {
    const collection = await TestTaskCollection.create(cli.session, {
        name: "Filtered roadmap",
        access: "Public",
        color: "cyan",
    });

    await collection.updateDefaults(cli.session, {
        filters: [
            {
                type: "Priority",
                operation: {type: "OneOf", priorities: new Set(["High", "Urgent"])},
            },
        ],
        sorts: [{type: "DueDate", direction: "Ascending"}],
    });

    expect(await cli.run("alpine search 'Filtered roadmap'")).toEqual(`\
1. [Filtered roadmap](/task-collection/filtered-roadmap)
`);

    expect(await cli.run("alpine read /task-collection/filtered-roadmap")).toEqual(`\
# Filtered roadmap

Color: Cyan

Default filters and sorts:

\`\`\`
priority=high,urgent&sort=due
\`\`\`

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task-collection/filtered-roadmap \\
  --old 'priority=high,urgent&sort=due' \\
  --new 'priority=low,medium&sort=-due'
`),
    ).toEqual(`\
Error: Couldn\u2019t update \`/task-collection/filtered-roadmap\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Changing the default filters and sorts of a task collection hasn\u2019t been implemented yet
`);
});

test("shuffle task collection tasks and observe the order with a fresh read", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Shuffle roadmap

- Shuffle alpha (Open)
- Shuffle bravo (Open)
- Shuffle charlie (Open)
- Shuffle delta (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Shuffle roadmap](/task-collection/shuffle-roadmap).

Also created the following tasks:

- [Shuffle alpha (Open)](/task/shuffle-alpha)

- [Shuffle bravo (Open)](/task/shuffle-bravo)

- [Shuffle charlie (Open)](/task/shuffle-charlie)

- [Shuffle delta (Open)](/task/shuffle-delta)
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
    expect(
        await cli.run(`\
alpine create task-collection '# Linked shuffle roadmap

- Linked shuffle alpha (Open)
- Linked shuffle bravo (Open)
- Linked shuffle charlie (Open)
- Linked shuffle delta (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Linked shuffle roadmap](/task-collection/linked-shuffle-roadmap).

Also created the following tasks:

- [Linked shuffle alpha (Open)](/task/linked-shuffle-alpha)

- [Linked shuffle bravo (Open)](/task/linked-shuffle-bravo)

- [Linked shuffle charlie (Open)](/task/linked-shuffle-charlie)

- [Linked shuffle delta (Open)](/task/linked-shuffle-delta)
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
    expect(
        await cli.run(`\
alpine create task-collection '# Move and add roadmap

- Move add alpha (Open)
- Move add bravo (Open)
- Move add charlie (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Move and add roadmap](/task-collection/move-and-add-roadmap).

Also created the following tasks:

- [Move add alpha (Open)](/task/move-add-alpha)

- [Move add bravo (Open)](/task/move-add-bravo)

- [Move add charlie (Open)](/task/move-add-charlie)
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

Created the following task: [Move add new task (Open)](/task/move-add-new-task).
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

test("create a task immediately before a moved task collection task", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Adjacent move roadmap

- Adjacent alpha (Open)
- Adjacent bravo (Open)
- Adjacent charlie (Open)
- Adjacent delta (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Adjacent move roadmap](/task-collection/adjacent-move-roadmap).

Also created the following tasks:

- [Adjacent alpha (Open)](/task/adjacent-alpha)

- [Adjacent bravo (Open)](/task/adjacent-bravo)

- [Adjacent charlie (Open)](/task/adjacent-charlie)

- [Adjacent delta (Open)](/task/adjacent-delta)
`);

    expect(
        await cli.run(`\
alpine update /task-collection/adjacent-move-roadmap \\
  --old '- Adjacent alpha (Open)
- Adjacent bravo (Open)
- Adjacent charlie (Open)
- Adjacent delta (Open)' \\
  --new '- Adjacent bravo (Open)
- Adjacent charlie (Open)
- Adjacent new task (Open)
- Adjacent alpha (Open)
- Adjacent delta (Open)'
`),
    ).toEqual(`\
Update was successful.

Created the following task: [Adjacent new task (Open)](/task/adjacent-new-task).
`);

    expect(await cli.run("alpine read /task-collection/adjacent-move-roadmap")).toEqual(`\
# Adjacent move roadmap

- [Adjacent bravo (Open)](/task/adjacent-bravo)

- [Adjacent charlie (Open)](/task/adjacent-charlie)

- [Adjacent new task (Open)](/task/adjacent-new-task)

- [Adjacent alpha (Open)](/task/adjacent-alpha)

- [Adjacent delta (Open)](/task/adjacent-delta)

End of tasks.
`);
});

test("create a subtask immediately after a moved subtask", async () => {
    expect(
        await cli.run(`\
alpine create task '# Adjacent subtask parent

## Subtasks

- Adjacent first subtask (Open)
- Adjacent second subtask (Open)
- Adjacent third subtask (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Adjacent subtask parent](/task/adjacent-subtask-parent).

Also created the following tasks:

- [Adjacent first subtask (Open)](/task/adjacent-first-subtask)

- [Adjacent second subtask (Open)](/task/adjacent-second-subtask)

- [Adjacent third subtask (Open)](/task/adjacent-third-subtask)
`);

    expect(await cli.run("alpine read /task/adjacent-subtask-parent/subtasks")).toEqual(`\
Subtasks for [Adjacent subtask parent (Open)](/task/adjacent-subtask-parent).

- [Adjacent first subtask (Open)](/task/adjacent-first-subtask)

- [Adjacent second subtask (Open)](/task/adjacent-second-subtask)

- [Adjacent third subtask (Open)](/task/adjacent-third-subtask)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task/adjacent-subtask-parent/subtasks \\
  --old '- [Adjacent first subtask (Open)](/task/adjacent-first-subtask)

- [Adjacent second subtask (Open)](/task/adjacent-second-subtask)

- [Adjacent third subtask (Open)](/task/adjacent-third-subtask)' \\
  --new '- [Adjacent second subtask (Open)](/task/adjacent-second-subtask)

- Adjacent new subtask 1 (Open)

- [Adjacent first subtask (Open)](/task/adjacent-first-subtask)

- Adjacent new subtask 2 (Open)

- [Adjacent third subtask (Open)](/task/adjacent-third-subtask)'
`),
    ).toEqual(`\
Update was successful.

Created the following tasks:

- [Adjacent new subtask 1 (Open)](/task/adjacent-new-subtask-1)

- [Adjacent new subtask 2 (Open)](/task/adjacent-new-subtask-2)
`);

    expect(await cli.run("alpine read /task/adjacent-subtask-parent/subtasks")).toEqual(`\
Subtasks for [Adjacent subtask parent (Open)](/task/adjacent-subtask-parent).

- [Adjacent second subtask (Open)](/task/adjacent-second-subtask)

- [Adjacent new subtask 1 (Open)](/task/adjacent-new-subtask-1)

- [Adjacent first subtask (Open)](/task/adjacent-first-subtask)

- [Adjacent new subtask 2 (Open)](/task/adjacent-new-subtask-2)

- [Adjacent third subtask (Open)](/task/adjacent-third-subtask)

End of tasks.
`);
});

test("update every embedded subtask field and remove every subtask", async () => {
    await cli.session.space.createSession({name: "Alice"});
    await cli.session.space.createSession({name: "Bob"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [Alice](/human/alice)
`);

    expect(await cli.run("alpine search Bob")).toEqual(`\
1. [Bob](/human/bob)

2. [My Bot](/bot/my-bot)
`);

    expect(
        await cli.run(`\
alpine create task-collection '# First child collection'
alpine create task-collection '# Second child collection'
alpine create task-collection '# Third child collection'
alpine create task-collection '# Fourth child collection'
`),
    ).toEqual(`\
Create was successful. New task collection: [First child collection](/task-collection/first-child-collection).
Create was successful. New task collection: [Second child collection](/task-collection/second-child-collection).
Create was successful. New task collection: [Third child collection](/task-collection/third-child-collection).
Create was successful. New task collection: [Fourth child collection](/task-collection/fourth-child-collection).
`);

    expect(
        await cli.run(`\
alpine create task '# Subtasks parent

## Subtasks

- Mutable child (Open)
  - Assignee: [Alice](/human/alice)
  - Collections: [First child collection](/task-collection/first-child-collection)
  - Priority: Low
  - Due date: July 10th, 2027

- Many collection child (Open)
  - Collections: [First child collection](/task-collection/first-child-collection), [Second child collection](/task-collection/second-child-collection), [Third child collection](/task-collection/third-child-collection), [Fourth child collection](/task-collection/fourth-child-collection)'
`),
    ).toEqual(`\
Create was successful. New task: [Subtasks parent](/task/subtasks-parent).

Also created the following tasks:

- [Mutable child (Open)](/task/mutable-child)

- [Many collection child (Open)](/task/many-collection-child)
`);

    expect(await cli.run("alpine read /task/subtasks-parent/subtasks")).toEqual(`\
Subtasks for [Subtasks parent (Open)](/task/subtasks-parent).

- [Mutable child (Open)](/task/mutable-child)
  - Assignee: [Alice](/human/alice)
  - Collections: [First child collection](/task-collection/first-child-collection)
  - Priority: Low
  - Due date: July 10th, 2027

- [Many collection child (Open)](/task/many-collection-child)
  - Collections: [First child collection](/task-collection/first-child-collection), [Second child collection](/task-collection/second-child-collection), [Third child collection](/task-collection/third-child-collection), and 1 more

End of tasks.
`);

    expect(
        await cli.run(`\
alpine create task '# Existing child

- Status: Closed
- Priority: Medium

## Subtasks

- Grandchild (Open)'
alpine update /task/subtasks-parent \\
  --old '# Subtasks parent' \\
  --new '# Subtasks parent

- Status: Closed'
`),
    ).toEqual(`\
Create was successful. New task: [Existing child](/task/existing-child).

Also created the following task: [Grandchild (Open)](/task/grandchild).
Update was successful.
`);

    expect(
        await cli.run(`\
alpine update /task/subtasks-parent/subtasks \\
  --old '[Mutable child (Open)](/task/mutable-child)' \\
  --new '[Renamed child (Open)](/task/mutable-child)'
alpine update /task/subtasks-parent/subtasks \\
  --old '- Assignee: [Alice](/human/alice)' \\
  --new '- Assignee: [Bob](/human/bob)'
alpine update /task/subtasks-parent/subtasks \\
  --old '[Renamed child (Open)](/task/mutable-child)' \\
  --new '[Renamed child (Open, active)](/task/mutable-child)'
alpine update /task/subtasks-parent/subtasks \\
  --old '- [Renamed child (Open, active)](/task/mutable-child)
  - Assignee: [Bob](/human/bob)
  - Collections: [First child collection](/task-collection/first-child-collection)' \\
  --new '- [Renamed child (Open, active)](/task/mutable-child)
  - Assignee: [Bob](/human/bob)
  - Collections: [Second child collection](/task-collection/second-child-collection)'
alpine update /task/subtasks-parent/subtasks \\
  --old '- Priority: Low' \\
  --new '- Priority: High'
alpine update /task/subtasks-parent/subtasks \\
  --old '- Due date: July 10th, 2027' \\
  --new '- Due date: July 12th, 2027'
alpine update /task/subtasks-parent/subtasks \\
  --old 'End of tasks.' \\
  --new '- [Existing child (Closed)](/task/existing-child)
  - Subtasks: 1 open
  - Priority: Medium

End of tasks.'
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task/subtasks-parent/subtasks")).toEqual(`\
Subtasks for [Subtasks parent (Closed)](/task/subtasks-parent).

- [Renamed child (Open, active)](/task/renamed-child)
  - Assignee: [Bob](/human/bob)
  - Collections: [Second child collection](/task-collection/second-child-collection)
  - Priority: High
  - Due date: July 12th, 2027

- [Many collection child (Open)](/task/many-collection-child)
  - Collections: [First child collection](/task-collection/first-child-collection), [Second child collection](/task-collection/second-child-collection), [Third child collection](/task-collection/third-child-collection), and 1 more

- [Existing child (Closed)](/task/existing-child)
  - Subtasks: 1 open
  - Priority: Medium

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task/subtasks-parent/subtasks \\
  --old '- [Renamed child (Open, active)](/task/renamed-child)
  - Assignee: [Bob](/human/bob)
  - Collections: [Second child collection](/task-collection/second-child-collection)
  - Priority: High
  - Due date: July 12th, 2027' \\
  --new ''
alpine update /task/subtasks-parent/subtasks \\
  --old '- [Many collection child (Open)](/task/many-collection-child)
  - Collections: [First child collection](/task-collection/first-child-collection), [Second child collection](/task-collection/second-child-collection), [Third child collection](/task-collection/third-child-collection), and 1 more' \\
  --new ''
alpine update /task/subtasks-parent/subtasks \\
  --old '- [Existing child (Closed)](/task/existing-child)
  - Subtasks: 1 open
  - Priority: Medium' \\
  --new ''
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Update was successful.
`);

    expect(await cli.run("alpine read /task/subtasks-parent/subtasks")).toEqual(`\
Subtasks for [Subtasks parent (Closed)](/task/subtasks-parent).

End of tasks.
`);
});

test("move task collection tasks in successive updates", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Successive moves roadmap

- Successive alpha (Open)
- Successive bravo (Open)
- Successive charlie (Open)
- Successive delta (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Successive moves roadmap](/task-collection/successive-moves-roadmap).

Also created the following tasks:

- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)

- [Successive charlie (Open)](/task/successive-charlie)

- [Successive delta (Open)](/task/successive-delta)
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

    expect(
        await cli.run(`\
alpine create task-collection '# Embedded existing roadmap

- Embedded existing task (Open)
  - Assignee: [Alice](/human/alice)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Embedded existing roadmap](/task-collection/embedded-existing-roadmap).

Also created the following task: [Embedded existing task (Open)](/task/embedded-existing-task).
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

    expect(
        await cli.run(`\
alpine create task-collection '# Embedded assignment roadmap

- Embedded assignment task (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Embedded assignment roadmap](/task-collection/embedded-assignment-roadmap).

Also created the following task: [Embedded assignment task (Open)](/task/embedded-assignment-task).
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

test("read and update an empty closed task comment page", async () => {
    expect(
        await cli.run(`\
alpine create task '# Closed discussion

- Status: Closed'
`),
    ).toEqual(`\
Create was successful. New task: [Closed discussion](/task/closed-discussion).
`);

    expect(await cli.run("alpine read /task/closed-discussion/comments")).toEqual(`\
Comments on [Closed discussion (Closed)](/task/closed-discussion).

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /task/closed-discussion/comments \\
  --old 'End of comments.' \\
  --new '<comment>

Closed task follow-up.

</comment>

End of comments.'
`),
    ).toEqual(`\
Update was successful.
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
    const parentComment = await task.createComment(
        aliceSession,
        "Solenodon initial task comment.",
        {
            overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z"),
        },
    );
    await task.createComment(aliceSession, "Xylophone west coast follow-up.", {
        parent: parentComment,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    expect(await cli.run("alpine search xylophone")).toEqual(`\
1. [Alice: **Xylophone** west coast follow-up.](/task-comment/alice-xylophone-west-coast-follow-up)
`);

    expect(await cli.run("alpine read /task-comment/alice-xylophone-west-coast-follow-up"))
        .toEqual(`\
Comments on [YouTube evidence review (Open, active)](/task/youtube-evidence-review).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Solenodon initial task comment.

</comment>

<comment id="1" from="[Alice](/human/alice)" time="5 minutes later" timezone="PDT">

<blockquote cite="?comment=0">

[Alice](/human/alice): Solenodon initial task comment.

</blockquote>

Xylophone west coast follow-up.

</comment>

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /task-comment/alice-xylophone-west-coast-follow-up --old 'End of comments.' --new '<comment>

I reviewed the launch evidence.

</comment>

End of comments.'
`),
    ).toEqual("Update was successful.\n");

    const newComment = await task._getMessage(cli.session.action(), 2);
    assert(newComment.payload.type === "Content");

    expect(newComment.payload.content.doc.textContent).toEqual("I reviewed the launch evidence.");
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

    expect(await cli.run("alpine search 'Task attachment source'")).toEqual(
        expect.stringContaining("[Task attachment source](/document/task-attachment-source)"),
    );
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

    expect(
        await cli.run(`\
alpine update /task-comment/alice-xylophone-source-discussion --old 'End of comments.' --new '<comment timezone="UTC">

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.'
`),
    ).toEqual("Update was successful.\n");

    expect(
        (await cli.run("alpine read /task-comment/alice-xylophone-source-discussion")).replace(
            /<time>([^<]+)<\/time>/g,
            (timeElement, label: string) =>
                label === "May 14th at 11:00am EDT" ? timeElement : "<time><created-time></time>",
        ),
    ).toEqual(`\
Comments on [YouTube attachment review (Open, active)](/task/youtube-attachment-review).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Xylophone source discussion.

</comment>

<time><created-time></time>

<comment id="1" from="[My](/bot/my-bot)">

I attached the image to this follow-up.

![](/file/image.png)

</comment>

End of comments.
`);

    const newComment = await task._getMessage(cli.session.action(), 1);
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

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** first comment.](/task-comment/alice-solenodon-first-comment)
`);

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

test("read a task page with more than fifty subtasks", async () => {
    const collection = await TestTaskCollection.create(cli.session, {
        name: "Large read state tasks",
        access: "Public",
    });
    const parentTask = await TestTask.create(cli.session, {
        title: "Large parent read state",
        collections: collection,
    });

    expect(await cli.run("alpine search 'Large read state tasks'")).toEqual(
        expect.stringContaining(
            "[Large read state tasks](/task-collection/large-read-state-tasks)",
        ),
    );

    expect(await cli.run("alpine read /task-collection/large-read-state-tasks")).toEqual(`\
# Large read state tasks

- [Large parent read state (Open)](/task/large-parent-read-state)

End of tasks.
`);

    for (let index = 1; index <= 51; index++) {
        await TestTask.create(cli.session, {
            title: `Read state subtask ${index}`,
            parent: parentTask,
        });
    }

    expect(await cli.run("alpine read /task/large-parent-read-state")).toEqual(`\
# Large parent read state

- Status: Open
- Collections: [Large read state tasks](/task-collection/large-read-state-tasks)

## Subtasks

- [Read state subtask 1 (Open)](/task/read-state-subtask-1)

- [Read state subtask 2 (Open)](/task/read-state-subtask-2)

- [Read state subtask 3 (Open)](/task/read-state-subtask-3)

- [Read state subtask 4 (Open)](/task/read-state-subtask-4)

- [Read state subtask 5 (Open)](/task/read-state-subtask-5)

- [Read state subtask 6 (Open)](/task/read-state-subtask-6)

- [Read state subtask 7 (Open)](/task/read-state-subtask-7)

- [Read state subtask 8 (Open)](/task/read-state-subtask-8)

- [Read state subtask 9 (Open)](/task/read-state-subtask-9)

- [Read state subtask 10 (Open)](/task/read-state-subtask-10)

- [Read state subtask 11 (Open)](/task/read-state-subtask-11)

- [Read state subtask 12 (Open)](/task/read-state-subtask-12)

- [Read state subtask 13 (Open)](/task/read-state-subtask-13)

- [Read state subtask 14 (Open)](/task/read-state-subtask-14)

- [Read state subtask 15 (Open)](/task/read-state-subtask-15)

- [Read state subtask 16 (Open)](/task/read-state-subtask-16)

- [Read state subtask 17 (Open)](/task/read-state-subtask-17)

- [Read state subtask 18 (Open)](/task/read-state-subtask-18)

- [Read state subtask 19 (Open)](/task/read-state-subtask-19)

- [Read state subtask 20 (Open)](/task/read-state-subtask-20)

- [Read state subtask 21 (Open)](/task/read-state-subtask-21)

- [Read state subtask 22 (Open)](/task/read-state-subtask-22)

- [Read state subtask 23 (Open)](/task/read-state-subtask-23)

- [Read state subtask 24 (Open)](/task/read-state-subtask-24)

- [Read state subtask 25 (Open)](/task/read-state-subtask-25)

- [Read state subtask 26 (Open)](/task/read-state-subtask-26)

- [Read state subtask 27 (Open)](/task/read-state-subtask-27)

- [Read state subtask 28 (Open)](/task/read-state-subtask-28)

- [Read state subtask 29 (Open)](/task/read-state-subtask-29)

- [Read state subtask 30 (Open)](/task/read-state-subtask-30)

- [Read state subtask 31 (Open)](/task/read-state-subtask-31)

- [Read state subtask 32 (Open)](/task/read-state-subtask-32)

- [Read state subtask 33 (Open)](/task/read-state-subtask-33)

- [Read state subtask 34 (Open)](/task/read-state-subtask-34)

- [Read state subtask 35 (Open)](/task/read-state-subtask-35)

- [Read state subtask 36 (Open)](/task/read-state-subtask-36)

- [Read state subtask 37 (Open)](/task/read-state-subtask-37)

- [Read state subtask 38 (Open)](/task/read-state-subtask-38)

- [Read state subtask 39 (Open)](/task/read-state-subtask-39)

- [Read state subtask 40 (Open)](/task/read-state-subtask-40)

- [Read state subtask 41 (Open)](/task/read-state-subtask-41)

- [Read state subtask 42 (Open)](/task/read-state-subtask-42)

- [Read state subtask 43 (Open)](/task/read-state-subtask-43)

- [Read state subtask 44 (Open)](/task/read-state-subtask-44)

- [Read state subtask 45 (Open)](/task/read-state-subtask-45)

- [Read state subtask 46 (Open)](/task/read-state-subtask-46)

- [Read state subtask 47 (Open)](/task/read-state-subtask-47)

- [Read state subtask 48 (Open)](/task/read-state-subtask-48)

- [Read state subtask 49 (Open)](/task/read-state-subtask-49)

- [Read state subtask 50 (Open)](/task/read-state-subtask-50)

[See more (1 remaining) »](/task/large-parent-read-state/subtasks?after=000000)
`);
});
