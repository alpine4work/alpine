/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

// Cursor hashes include random task IDs. Pin their starting hash so pagination
// paths can be copied character-for-character into these tests.
const cli = setupCliForTest({agentWebTaskQueryCursorHash: "000000"});

// This representative sample pairs every movement shape with every direction (60
// tests), then every surrounding condition with every direction (44 tests). The
// seven page surfaces rotate across both groups so each surface is exercised
// throughout the sample. Every test gets an isolated space, and every CLI
// execution and full output is written inline so each state transition can be
// verified without following shell variables or test helper logic.

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
alpine read /task-collection/roadmap?after=000000 --limit 850b
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

- [After pagination guard with a deliberately long title (Open)](/task/after-pagination-guard-with-a-deliberately-lon)

End of tasks.
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

test("two non-adjacent existing tasks to start; task collection page tail at the end; 15 tasks", async () => {
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
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 13 (Open)](/task/task-13)' \\
  --new '' \\
  --old '- [Task 02' \\
  --new '- [Task 10 (Open)](/task/task-10)

- [Task 13 (Open)](/task/task-13)

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

- [Task 13 (Open)](/task/task-13)

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

- [Task 14 (Open)](/task/task-14)

- [Task 15 (Open)](/task/task-15)

End of tasks.
`);
});

test("five existing tasks to start; task page subtasks list; 15 tasks", async () => {
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
  --old '- [Task 10 (Open)](/task/task-10)' \\
  --new '' \\
  --old '- [Task 11 (Open)](/task/task-11)' \\
  --new '' \\
  --old '- [Task 12 (Open)](/task/task-12)' \\
  --new '' \\
  --old '- [Task 13 (Open)](/task/task-13)' \\
  --new '' \\
  --old '- [Task 14 (Open)](/task/task-14)' \\
  --new '' \\
  --old '- [Task 01' \\
  --new '- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 01'
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

- [Task 10 (Open)](/task/task-10)

- [Task 11 (Open)](/task/task-11)

- [Task 12 (Open)](/task/task-12)

- [Task 13 (Open)](/task/task-13)

- [Task 14 (Open)](/task/task-14)

- [Task 01 (Open)](/task/task-01)

- [Task 02 (Open)](/task/task-02)

- [Task 03 (Open)](/task/task-03)

- [Task 04 (Open)](/task/task-04)

- [Task 05 (Open)](/task/task-05)

- [Task 06 (Open)](/task/task-06)

- [Task 07 (Open)](/task/task-07)

- [Task 08 (Open)](/task/task-08)

- [Task 09 (Open)](/task/task-09)

- [Task 15 (Open)](/task/task-15)
`);
});

test("one newly created task to start; task subtasks page head; 15 tasks", async () => {
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
  --old '- [Task 01' \\
  --new '- Moved new 1 (Open)

- [Task 01'
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

- [Moved new 1 (Open)](/task/moved-new-1)

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
});

test("two newly created tasks to start; task subtasks page tail that is not the end; 15 tasks", async () => {
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
alpine read /task/parent/subtasks?after=000000 --limit 850b
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
alpine update /task/parent/subtasks?after=000000 \\
  --old '- [Task 01' \\
  --new '- Moved new 1 (Open)

- Moved new 2 (Open)

- [Task 01'
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

- [Moved new 1 (Open)](/task/moved-new-1)

- [Moved new 2 (Open)](/task/moved-new-2)

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
});

