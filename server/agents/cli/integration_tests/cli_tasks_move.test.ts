/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

// Cursor hashes include random task IDs. Pin their starting hash so pagination
// paths can be copied character-for-character into these tests.
const cli = setupCliForTest({agentWebTaskQueryCursorHash: "000000"});

// This representative sample has three tests for each movement direction. Across
// those 12 tests it covers every page surface; one, two, and five-task moves;
// existing, newly created, previous-update, and mixed task groups; and disruptive
// changes elsewhere in the list. Every CLI execution and full output stays inline
// so each transition can be verified without following helpers or shell variables.

test("one existing task to start; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).

Also created these tasks:

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 850b
`),
    ).toEqual(`\
# Roadmap

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task-collection/roadmap \\
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 01' \\
  --new '- [Task 10 (Open)](/task/task-10)

- [Task 01'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 100kb
`),
    ).toEqual(`\
# Roadmap

- [Task 10 (Open)](/task/task-10)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("two adjacent existing tasks to start; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 160b
`),
    ).toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=000000)

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap?after=000000 --limit 600b
`),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=000001)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task-collection/roadmap?after=000000 \\
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 11 (Open)](/task/task-11)' \\
  --new '' \\
  --old '- [Task 02' \\
  --new '- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 02'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 100kb
`),
    ).toEqual(`\
# Roadmap

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("two existing and three newly created tasks interleaved to start; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 160b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000000)

- [Before (Open)](/task/before)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks?after=000000 --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 11 (Open)](/task/task-11)' \\
  --new '' \\
  --old '- [Task 01' \\
  --new '- [Task 10 (Open)](/task/task-10)

- Moved new 1 (Open)

- [Task 11 (Open)](/task/task-11)

- Moved new 2 (Open)

- Moved new 3 (Open)

- [Task 01'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Moved new 1 (Open)](/task/moved-new-1)

- [Moved new 2 (Open)](/task/moved-new-2)

- [Moved new 3 (Open)](/task/moved-new-3)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Before (Open)](/task/before)

- [Task 10 (Open)](/task/task-10)

- [Moved new 1 (Open)](/task/moved-new-1)

- [Task 11 (Open)](/task/task-11)

- [Moved new 2 (Open)](/task/moved-new-2)

- [Moved new 3 (Open)](/task/moved-new-3)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

End of tasks.
`);
});

test("two non-adjacent existing tasks to end; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine read /task/parent --limit 100kb
`),
    ).toEqual(`\
# Parent

- Status: Open

## Subtasks

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task/parent \\
  --old '- [Task 02 (Open)](/task/task-02)' \\
  --new '' \\
  --old '- [Task 05 (Open)](/task/task-05)' \\
  --new '' \\
  --old '- [Task 15 (Open)](/task/task-15)' \\
  --new '- [Task 15 (Open)](/task/task-15)

- [Task 02 (Open)](/task/task-02)

- [Task 05 (Open)](/task/task-05)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task/parent --limit 100kb
`),
    ).toEqual(`\
# Parent

- Status: Open

## Subtasks

- [Task 01 (Open)](/task/task-01)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [Task 02 (Open)](/task/task-02)

- [Task 05 (Open)](/task/task-05)
`);
});

test("one newly created task to end; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 160b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000000)

- [Before (Open)](/task/before)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks?after=000000 --limit 700b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000001)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- [Task 15 (Open)](/task/task-15)' \\
  --new '- [Task 15 (Open)](/task/task-15)

- Moved new 1 (Open)'
`),
    ).toEqual(`\
Update was successful.

Created this task: [Moved new 1 (Open)](/task/moved-new-1).
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [Moved new 1 (Open)](/task/moved-new-1)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("five newly created tasks to the bottom third from the top third; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 160b
`),
    ).toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=000000)

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap?after=000000 --limit 600b
`),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=000001)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task-collection/roadmap?after=000000 \\
  --old '- [Task 13' \\
  --new '- Moved new 1 (Open)

- Moved new 2 (Open)

- Moved new 3 (Open)

- Moved new 4 (Open)

- Moved new 5 (Open)

- [Task 13'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Moved new 1 (Open)](/task/moved-new-1)

- [Moved new 2 (Open)](/task/moved-new-2)

- [Moved new 3 (Open)](/task/moved-new-3)

- [Moved new 4 (Open)](/task/moved-new-4)

- [Moved new 5 (Open)](/task/moved-new-5)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 100kb
`),
    ).toEqual(`\
# Roadmap

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Moved new 1 (Open)](/task/moved-new-1)

- [Moved new 2 (Open)](/task/moved-new-2)

- [Moved new 3 (Open)](/task/moved-new-3)

- [Moved new 4 (Open)](/task/moved-new-4)

- [Moved new 5 (Open)](/task/moved-new-5)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("five tasks created by the previous update to the top third from the bottom third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 160b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000000)

- [Before (Open)](/task/before)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks?after=000000 --limit 700b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000001)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- [Task 11' \\
  --new '- Moved previous 1 (Open)

- Moved previous 2 (Open)

- Moved previous 3 (Open)

- Moved previous 4 (Open)

- Moved previous 5 (Open)

- [Task 11'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Moved previous 1 (Open)](/task/moved-previous-1)

- [Moved previous 2 (Open)](/task/moved-previous-2)

- [Moved previous 3 (Open)](/task/moved-previous-3)

- [Moved previous 4 (Open)](/task/moved-previous-4)

- [Moved previous 5 (Open)](/task/moved-previous-5)
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- Moved previous 1 (Open)' \\
  --new '' \\
  --old '- Moved previous 2 (Open)' \\
  --new '' \\
  --old '- Moved previous 3 (Open)' \\
  --new '' \\
  --old '- Moved previous 4 (Open)' \\
  --new '' \\
  --old '- Moved previous 5 (Open)' \\
  --new '' \\
  --old '- [Task 04' \\
  --new '- Moved previous 1 (Open)

- Moved previous 2 (Open)

- Moved previous 3 (Open)

- Moved previous 4 (Open)

- Moved previous 5 (Open)

- [Task 04'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Moved previous 1 (Open)](/task/moved-previous-1)

- [Moved previous 2 (Open)](/task/moved-previous-2)

- [Moved previous 3 (Open)](/task/moved-previous-3)

- [Moved previous 4 (Open)](/task/moved-previous-4)

- [Moved previous 5 (Open)](/task/moved-previous-5)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("one existing task to end; task collection page tail at the end; two other existing tasks swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 160b
`),
    ).toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=000000)

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap?after=000000 --limit 100kb
`),
    ).toEqual(`\
Tasks in Roadmap.

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task-collection/roadmap?after=000000 \\
  --old '- [Task 02 (Open)](/task/task-02)' \\
  --new '' \\
  --old '- [Task 07 (Open)](/task/task-07)' \\
  --new '' \\
  --old '- [Task 08 (Open)](/task/task-08)' \\
  --new '' \\
  --old '- [Task 10' \\
  --new '- [Task 08 (Open)](/task/task-08)

- [Task 07 (Open)](/task/task-07)

- [Task 10' \\
  --old '- [Task 15 (Open)](/task/task-15)' \\
  --new '- [Task 15 (Open)](/task/task-15)

- [Task 02 (Open)](/task/task-02)'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 100kb
`),
    ).toEqual(`\
# Roadmap

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 09 (Open)](/task/task-09)

- [Task 08 (Open)](/task/task-08)

- [Task 07 (Open)](/task/task-07)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [Task 02 (Open)](/task/task-02)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page tail that is not the end; two other non-adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap](/task-collection/roadmap).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 160b
`),
    ).toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=000000)

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap?after=000000 --limit 600b
`),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=000001)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task-collection/roadmap?after=000000 \\
  --old '- [Task 02 (Open)](/task/task-02)' \\
  --new '' \\
  --old '- [Task 07' \\
  --new '- Condition new 1 (Open)

- [Task 07' \\
  --old '- [Task 10' \\
  --new '- Condition new 2 (Open)

- [Task 10' \\
  --old '- [Task 13' \\
  --new '- [Task 02 (Open)](/task/task-02)

- [Task 13'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Condition new 1 (Open)](/task/condition-new-1)

- [Condition new 2 (Open)](/task/condition-new-2)
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap --limit 100kb
`),
    ).toEqual(`\
# Roadmap

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Condition new 1 (Open)](/task/condition-new-1)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Condition new 2 (Open)](/task/condition-new-2)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 02 (Open)](/task/task-02)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task page subtasks list; two other adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine read /task/parent --limit 100kb
`),
    ).toEqual(`\
# Parent

- Status: Open

## Subtasks

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task/parent \\
  --old '- [Task 08' \\
  --new '- Condition previous 1 (Open)

- Condition previous 2 (Open)

- [Task 08'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Condition previous 1 (Open)](/task/condition-previous-1)

- [Condition previous 2 (Open)](/task/condition-previous-2)
`);

    expect(
        await cli.run(`\
alpine update /task/parent \\
  --old '- [Task 02 (Open)](/task/task-02)' \\
  --new '' \\
  --old '- [Task 13' \\
  --new '- [Task 02 (Open)](/task/task-02)

- [Task 13'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task/parent --limit 100kb
`),
    ).toEqual(`\
# Parent

- Status: Open

## Subtasks

- [Task 01 (Open)](/task/task-01)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Condition previous 1 (Open)](/task/condition-previous-1)

- [Condition previous 2 (Open)](/task/condition-previous-2)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 02 (Open)](/task/task-02)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);
});

test("one existing task to the top third from the bottom third; task subtasks page head; one other link-less task from the previous update moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 850b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks \\
  --old '- [Task 08' \\
  --new '- Condition previous 1 (Open)

- [Task 08'
`),
    ).toEqual(`\
Update was successful.

Created this task: [Condition previous 1 (Open)](/task/condition-previous-1).
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks \\
  --old '- Condition previous 1 (Open)' \\
  --new '' \\
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 04' \\
  --new '- [Task 10 (Open)](/task/task-10)

- Condition previous 1 (Open)

- [Task 04'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 10 (Open)](/task/task-10)

- [Condition previous 1 (Open)](/task/condition-previous-1)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task subtasks page tail that is not the end; two other link-less tasks from the previous update swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent

## Subtasks

- Before (Open)
- Task 01 (Open)
- Task 02 (Open)
- Task 03 (Open)
- Task 04 (Open)
- Task 05 (Open)
- Task 06 (Open)
- Task 07 (Open)
- Task 08 (Open)
- Task 09 (Open)
- Task 10 (Open)
- Task 11 (Open)
- Task 12 (Open)
- Task 13 (Open)
- Task 14 (Open)
- Task 15 (Open)
- After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent](/task/parent).

Also created these tasks:

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 160b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000000)

- [Before (Open)](/task/before)
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks?after=000000 --limit 700b
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent). [Next page »](/task/parent/subtasks?after=000001)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- [Task 07' \\
  --new '- Condition previous 1 (Open)

- [Task 07' \\
  --old '- [Task 10' \\
  --new '- Condition previous 2 (Open)

- [Task 10'
`),
    ).toEqual(`\
Update was successful.

Created these tasks:

- [Condition previous 1 (Open)](/task/condition-previous-1)

- [Condition previous 2 (Open)](/task/condition-previous-2)
`);

    expect(
        await cli.run(`\
alpine update /task/parent/subtasks?after=000000 \\
  --old '- Condition previous 1 (Open)' \\
  --new '' \\
  --old '- Condition previous 2 (Open)' \\
  --new '' \\
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 04' \\
  --new '- [Task 10 (Open)](/task/task-10)

- [Task 04' \\
  --old '- [Task 07' \\
  --new '- Condition previous 2 (Open)

- [Task 07' \\
  --old '- [Task 11' \\
  --new '- Condition previous 1 (Open)

- [Task 11'
`),
    ).toEqual(`\
Update was successful.
`);

    expect(
        await cli.run(`\
alpine read /task/parent/subtasks --limit 100kb
`),
    ).toEqual(`\
Subtasks for [Parent (Open)](/task/parent).

- [Before (Open)](/task/before)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 10 (Open)](/task/task-10)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Condition previous 2 (Open)](/task/condition-previous-2)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Condition previous 1 (Open)](/task/condition-previous-1)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
`);
});
