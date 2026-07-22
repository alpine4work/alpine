/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest();

beforeAll(async () => {
    await cli.session.space.createSession({name: "Avery Quartz", role: "Member"});
    await cli.session.space.createSession({name: "Blake Cedar", role: "Member"});
    await cli.session.space.createSession({name: "Casey Amber", role: "Member"});
    await cli.session.space.createSession({name: "Drew Indigo", role: "Member"});
    await cli.session.space.createSession({name: "Emery Sienna", role: "Member"});
});

test("create an active task assigned to another account", async () => {
    await cli.run("alpine search 'Avery Quartz'");

    expect(
        await cli.run(`\
alpine create task '# Prepare active launch

- Status: Open (Active)
- Assignee: [Avery](/human/avery-quartz)'
`),
    ).toEqual(`\
Create was successful. New task: [Prepare active launch](/task/prepare-active-launch).
`);

    expect(await cli.run("alpine read /task/prepare-active-launch")).toEqual(`\
# Prepare active launch

- Status: Open (Active)
- Assignee: [Avery](/human/avery-quartz)
`);
});

test("activate a task already assigned to another account", async () => {
    expect(await cli.run("alpine search 'Blake Cedar'")).toEqual(`\
1. [Blake Cedar](/human/blake-cedar)
`);

    expect(
        await cli.run(`\
alpine create task '# Activate existing assignment

- Status: Open
- Assignee: [Blake](/human/blake-cedar)'
`),
    ).toEqual(`\
Create was successful. New task: [Activate existing assignment](/task/activate-existing-assignment).
`);

    await cli.run("alpine read /task/activate-existing-assignment");

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
- Assignee: [Blake](/human/blake-cedar)
`);
});

test("activate and assign a task to another account in the same update", async () => {
    expect(await cli.run("alpine search 'Casey Amber'")).toEqual(`\
1. [Casey Amber](/human/casey-amber)
`);

    await cli.run("alpine create task '# Activate and assign'");
    await cli.run("alpine read /task/activate-and-assign");

    expect(
        await cli.run(`\
alpine update /task/activate-and-assign \\
  --old '- Status: Open' \\
  --new '- Status: Open (Active)
- Assignee: [Casey](/human/casey-amber)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task/activate-and-assign")).toEqual(`\
# Activate and assign

- Status: Open (Active)
- Assignee: [Casey](/human/casey-amber)
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

test("shuffle task collection tasks and observe the order with a fresh read", async () => {
    await cli.run(`\
alpine create task-collection '# Shuffle roadmap

- Shuffle alpha (Open)
- Shuffle bravo (Open)
- Shuffle charlie (Open)
- Shuffle delta (Open)'
`);

    await cli.run("alpine read /task-collection/shuffle-roadmap");

    expect(
        await cli.run(`\
alpine update /task-collection/shuffle-roadmap \\
  --old '- [Shuffle alpha (Open)](/task/shuffle-alpha)

- [Shuffle bravo (Open)](/task/shuffle-bravo)

- [Shuffle charlie (Open)](/task/shuffle-charlie)

- [Shuffle delta (Open)](/task/shuffle-delta)' \\
  --new '- [Shuffle charlie (Open)](/task/shuffle-charlie)

- [Shuffle alpha (Open)](/task/shuffle-alpha)

- [Shuffle delta (Open)](/task/shuffle-delta)

- [Shuffle bravo (Open)](/task/shuffle-bravo)'
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

test("move and add task collection tasks in the same update", async () => {
    await cli.run(`\
alpine create task-collection '# Move and add roadmap

- Move add alpha (Open)
- Move add bravo (Open)
- Move add charlie (Open)'
`);

    await cli.run("alpine read /task-collection/move-and-add-roadmap");

    expect(
        await cli.run(`\
alpine update /task-collection/move-and-add-roadmap \\
  --old '- [Move add alpha (Open)](/task/move-add-alpha)

- [Move add bravo (Open)](/task/move-add-bravo)

- [Move add charlie (Open)](/task/move-add-charlie)' \\
  --new '- [Move add charlie (Open)](/task/move-add-charlie)

- Move add new task (Open)

- [Move add alpha (Open)](/task/move-add-alpha)

- [Move add bravo (Open)](/task/move-add-bravo)'
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

    await cli.run("alpine read /task-collection/successive-moves-roadmap");

    expect(
        await cli.run(`\
alpine update /task-collection/successive-moves-roadmap \\
  --old '- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)

- [Successive charlie (Open)](/task/successive-charlie)

- [Successive delta (Open)](/task/successive-delta)' \\
  --new '- [Successive delta (Open)](/task/successive-delta)

- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)

- [Successive charlie (Open)](/task/successive-charlie)'

alpine update /task-collection/successive-moves-roadmap \\
  --old '- [Successive delta (Open)](/task/successive-delta)

- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)

- [Successive charlie (Open)](/task/successive-charlie)' \\
  --new '- [Successive delta (Open)](/task/successive-delta)

- [Successive charlie (Open)](/task/successive-charlie)

- [Successive alpha (Open)](/task/successive-alpha)

- [Successive bravo (Open)](/task/successive-bravo)'
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
    await cli.run("alpine search 'Drew Indigo'");

    await cli.run(`\
alpine create task-collection '# Embedded existing roadmap

- Embedded existing task (Open)
  - Assignee: [Drew](/human/drew-indigo)'
`);

    await cli.run("alpine read /task-collection/embedded-existing-roadmap");

    expect(
        await cli.run(
            "alpine update /task-collection/embedded-existing-roadmap --old '[Embedded existing task (Open)]' --new '[Embedded existing task (Open, active)]'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/embedded-existing-roadmap")).toEqual(`\
# Embedded existing roadmap

- [Embedded existing task (Open, active)](/task/embedded-existing-task)
  - Assignee: [Drew](/human/drew-indigo)

End of tasks.
`);
});

test("activate and assign an embedded task in the same update", async () => {
    expect(await cli.run("alpine search 'Emery Sienna'")).toEqual(`\
1. [Emery Sienna](/human/emery-sienna)
`);

    await cli.run(`\
alpine create task-collection '# Embedded assignment roadmap

- Embedded assignment task (Open)'
`);

    await cli.run("alpine read /task-collection/embedded-assignment-roadmap");

    expect(
        await cli.run(`\
alpine update /task-collection/embedded-assignment-roadmap \\
  --old '- [Embedded assignment task (Open)](/task/embedded-assignment-task)' \\
  --new '- [Embedded assignment task (Open, active)](/task/embedded-assignment-task)
  - Assignee: [Emery](/human/emery-sienna)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /task-collection/embedded-assignment-roadmap")).toEqual(`\
# Embedded assignment roadmap

- [Embedded assignment task (Open, active)](/task/embedded-assignment-task)
  - Assignee: [Emery](/human/emery-sienna)

End of tasks.
`);
});
