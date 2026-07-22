import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest();

// This representative sample pairs every movement shape with every direction (60
// tests), then every surrounding condition with every direction (44 tests). The
// seven page surfaces rotate across both groups so each surface is exercised
// throughout the sample. Every fixture, update, and expected output is written
// inline so a case can be verified without following test helper logic.

test("one existing task to start; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 001

- 001 Task 01 (Open)
- 001 Task 02 (Open)
- 001 Task 03 (Open)
- 001 Task 04 (Open)
- 001 Task 05 (Open)
- 001 Task 06 (Open)
- 001 Task 07 (Open)
- 001 Task 08 (Open)
- 001 Task 09 (Open)
- 001 Task 10 (Open)
- 001 Task 11 (Open)
- 001 Task 12 (Open)
- 001 Task 13 (Open)
- 001 Task 14 (Open)
- 001 Task 15 (Open)
- 001 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 001](/task-collection/roadmap-001).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-001 --limit 850b >/dev/null
alpine update /task-collection/roadmap-001 \\
  --old '- [001 Task 01 (Open)](/task/001-task-01)

- [001 Task 02 (Open)](/task/001-task-02)

- [001 Task 03 (Open)](/task/001-task-03)

- [001 Task 04 (Open)](/task/001-task-04)

- [001 Task 05 (Open)](/task/001-task-05)

- [001 Task 06 (Open)](/task/001-task-06)

- [001 Task 07 (Open)](/task/001-task-07)

- [001 Task 08 (Open)](/task/001-task-08)

- [001 Task 09 (Open)](/task/001-task-09)

- [001 Task 10 (Open)](/task/001-task-10)

- [001 Task 11 (Open)](/task/001-task-11)

- [001 Task 12 (Open)](/task/001-task-12)

- [001 Task 13 (Open)](/task/001-task-13)

- [001 Task 14 (Open)](/task/001-task-14)

- [001 Task 15 (Open)](/task/001-task-15)' \\
  --new '- [001 Task 10 (Open)](/task/001-task-10)

- [001 Task 01 (Open)](/task/001-task-01)

- [001 Task 02 (Open)](/task/001-task-02)

- [001 Task 03 (Open)](/task/001-task-03)

- [001 Task 04 (Open)](/task/001-task-04)

- [001 Task 05 (Open)](/task/001-task-05)

- [001 Task 06 (Open)](/task/001-task-06)

- [001 Task 07 (Open)](/task/001-task-07)

- [001 Task 08 (Open)](/task/001-task-08)

- [001 Task 09 (Open)](/task/001-task-09)

- [001 Task 11 (Open)](/task/001-task-11)

- [001 Task 12 (Open)](/task/001-task-12)

- [001 Task 13 (Open)](/task/001-task-13)

- [001 Task 14 (Open)](/task/001-task-14)

- [001 Task 15 (Open)](/task/001-task-15)'
alpine read /task-collection/roadmap-001 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 001

- [001 Task 10 (Open)](/task/001-task-10)

- [001 Task 01 (Open)](/task/001-task-01)

- [001 Task 02 (Open)](/task/001-task-02)

- [001 Task 03 (Open)](/task/001-task-03)

- [001 Task 04 (Open)](/task/001-task-04)

- [001 Task 05 (Open)](/task/001-task-05)

- [001 Task 06 (Open)](/task/001-task-06)

- [001 Task 07 (Open)](/task/001-task-07)

- [001 Task 08 (Open)](/task/001-task-08)

- [001 Task 09 (Open)](/task/001-task-09)

- [001 Task 11 (Open)](/task/001-task-11)

- [001 Task 12 (Open)](/task/001-task-12)

- [001 Task 13 (Open)](/task/001-task-13)

- [001 Task 14 (Open)](/task/001-task-14)

- [001 Task 15 (Open)](/task/001-task-15)

- [001 After pagination guard with a deliberately long title (Open)](/task/001-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two adjacent existing tasks to start; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 002

- 002 Before (Open)
- 002 Task 01 (Open)
- 002 Task 02 (Open)
- 002 Task 03 (Open)
- 002 Task 04 (Open)
- 002 Task 05 (Open)
- 002 Task 06 (Open)
- 002 Task 07 (Open)
- 002 Task 08 (Open)
- 002 Task 09 (Open)
- 002 Task 10 (Open)
- 002 Task 11 (Open)
- 002 Task 12 (Open)
- 002 Task 13 (Open)
- 002 Task 14 (Open)
- 002 Task 15 (Open)
- 002 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 002](/task-collection/roadmap-002).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-002 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [002 Task 01 (Open)](/task/002-task-01)

- [002 Task 02 (Open)](/task/002-task-02)

- [002 Task 03 (Open)](/task/002-task-03)

- [002 Task 04 (Open)](/task/002-task-04)

- [002 Task 05 (Open)](/task/002-task-05)

- [002 Task 06 (Open)](/task/002-task-06)

- [002 Task 07 (Open)](/task/002-task-07)

- [002 Task 08 (Open)](/task/002-task-08)

- [002 Task 09 (Open)](/task/002-task-09)

- [002 Task 10 (Open)](/task/002-task-10)

- [002 Task 11 (Open)](/task/002-task-11)

- [002 Task 12 (Open)](/task/002-task-12)

- [002 Task 13 (Open)](/task/002-task-13)

- [002 Task 14 (Open)](/task/002-task-14)

- [002 Task 15 (Open)](/task/002-task-15)' \\
  --new '- [002 Task 10 (Open)](/task/002-task-10)

- [002 Task 11 (Open)](/task/002-task-11)

- [002 Task 01 (Open)](/task/002-task-01)

- [002 Task 02 (Open)](/task/002-task-02)

- [002 Task 03 (Open)](/task/002-task-03)

- [002 Task 04 (Open)](/task/002-task-04)

- [002 Task 05 (Open)](/task/002-task-05)

- [002 Task 06 (Open)](/task/002-task-06)

- [002 Task 07 (Open)](/task/002-task-07)

- [002 Task 08 (Open)](/task/002-task-08)

- [002 Task 09 (Open)](/task/002-task-09)

- [002 Task 12 (Open)](/task/002-task-12)

- [002 Task 13 (Open)](/task/002-task-13)

- [002 Task 14 (Open)](/task/002-task-14)

- [002 Task 15 (Open)](/task/002-task-15)'
alpine read /task-collection/roadmap-002 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 002

- [002 Before (Open)](/task/002-before)

- [002 Task 10 (Open)](/task/002-task-10)

- [002 Task 11 (Open)](/task/002-task-11)

- [002 Task 01 (Open)](/task/002-task-01)

- [002 Task 02 (Open)](/task/002-task-02)

- [002 Task 03 (Open)](/task/002-task-03)

- [002 Task 04 (Open)](/task/002-task-04)

- [002 Task 05 (Open)](/task/002-task-05)

- [002 Task 06 (Open)](/task/002-task-06)

- [002 Task 07 (Open)](/task/002-task-07)

- [002 Task 08 (Open)](/task/002-task-08)

- [002 Task 09 (Open)](/task/002-task-09)

- [002 Task 12 (Open)](/task/002-task-12)

- [002 Task 13 (Open)](/task/002-task-13)

- [002 Task 14 (Open)](/task/002-task-14)

- [002 Task 15 (Open)](/task/002-task-15)

- [002 After pagination guard with a deliberately long title (Open)](/task/002-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two non-adjacent existing tasks to start; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 003

- 003 Before (Open)
- 003 Task 01 (Open)
- 003 Task 02 (Open)
- 003 Task 03 (Open)
- 003 Task 04 (Open)
- 003 Task 05 (Open)
- 003 Task 06 (Open)
- 003 Task 07 (Open)
- 003 Task 08 (Open)
- 003 Task 09 (Open)
- 003 Task 10 (Open)
- 003 Task 11 (Open)
- 003 Task 12 (Open)
- 003 Task 13 (Open)
- 003 Task 14 (Open)
- 003 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 003](/task-collection/roadmap-003).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-003 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [003 Task 01 (Open)](/task/003-task-01)

- [003 Task 02 (Open)](/task/003-task-02)

- [003 Task 03 (Open)](/task/003-task-03)

- [003 Task 04 (Open)](/task/003-task-04)

- [003 Task 05 (Open)](/task/003-task-05)

- [003 Task 06 (Open)](/task/003-task-06)

- [003 Task 07 (Open)](/task/003-task-07)

- [003 Task 08 (Open)](/task/003-task-08)

- [003 Task 09 (Open)](/task/003-task-09)

- [003 Task 10 (Open)](/task/003-task-10)

- [003 Task 11 (Open)](/task/003-task-11)

- [003 Task 12 (Open)](/task/003-task-12)

- [003 Task 13 (Open)](/task/003-task-13)

- [003 Task 14 (Open)](/task/003-task-14)

- [003 Task 15 (Open)](/task/003-task-15)' \\
  --new '- [003 Task 10 (Open)](/task/003-task-10)

- [003 Task 13 (Open)](/task/003-task-13)

- [003 Task 01 (Open)](/task/003-task-01)

- [003 Task 02 (Open)](/task/003-task-02)

- [003 Task 03 (Open)](/task/003-task-03)

- [003 Task 04 (Open)](/task/003-task-04)

- [003 Task 05 (Open)](/task/003-task-05)

- [003 Task 06 (Open)](/task/003-task-06)

- [003 Task 07 (Open)](/task/003-task-07)

- [003 Task 08 (Open)](/task/003-task-08)

- [003 Task 09 (Open)](/task/003-task-09)

- [003 Task 11 (Open)](/task/003-task-11)

- [003 Task 12 (Open)](/task/003-task-12)

- [003 Task 14 (Open)](/task/003-task-14)

- [003 Task 15 (Open)](/task/003-task-15)'
alpine read /task-collection/roadmap-003 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 003

- [003 Before (Open)](/task/003-before)

- [003 Task 10 (Open)](/task/003-task-10)

- [003 Task 13 (Open)](/task/003-task-13)

- [003 Task 01 (Open)](/task/003-task-01)

- [003 Task 02 (Open)](/task/003-task-02)

- [003 Task 03 (Open)](/task/003-task-03)

- [003 Task 04 (Open)](/task/003-task-04)

- [003 Task 05 (Open)](/task/003-task-05)

- [003 Task 06 (Open)](/task/003-task-06)

- [003 Task 07 (Open)](/task/003-task-07)

- [003 Task 08 (Open)](/task/003-task-08)

- [003 Task 09 (Open)](/task/003-task-09)

- [003 Task 11 (Open)](/task/003-task-11)

- [003 Task 12 (Open)](/task/003-task-12)

- [003 Task 14 (Open)](/task/003-task-14)

- [003 Task 15 (Open)](/task/003-task-15)

End of tasks.
`);
});

test("five existing tasks to start; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 004

## Subtasks

- 004 Task 01 (Open)
- 004 Task 02 (Open)
- 004 Task 03 (Open)
- 004 Task 04 (Open)
- 004 Task 05 (Open)
- 004 Task 06 (Open)
- 004 Task 07 (Open)
- 004 Task 08 (Open)
- 004 Task 09 (Open)
- 004 Task 10 (Open)
- 004 Task 11 (Open)
- 004 Task 12 (Open)
- 004 Task 13 (Open)
- 004 Task 14 (Open)
- 004 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 004](/task/parent-004).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-004 --limit 100kb >/dev/null
alpine update /task/parent-004 \\
  --old '- [004 Task 01 (Open)](/task/004-task-01)

- [004 Task 02 (Open)](/task/004-task-02)

- [004 Task 03 (Open)](/task/004-task-03)

- [004 Task 04 (Open)](/task/004-task-04)

- [004 Task 05 (Open)](/task/004-task-05)

- [004 Task 06 (Open)](/task/004-task-06)

- [004 Task 07 (Open)](/task/004-task-07)

- [004 Task 08 (Open)](/task/004-task-08)

- [004 Task 09 (Open)](/task/004-task-09)

- [004 Task 10 (Open)](/task/004-task-10)

- [004 Task 11 (Open)](/task/004-task-11)

- [004 Task 12 (Open)](/task/004-task-12)

- [004 Task 13 (Open)](/task/004-task-13)

- [004 Task 14 (Open)](/task/004-task-14)

- [004 Task 15 (Open)](/task/004-task-15)' \\
  --new '- [004 Task 10 (Open)](/task/004-task-10)

- [004 Task 11 (Open)](/task/004-task-11)

- [004 Task 12 (Open)](/task/004-task-12)

- [004 Task 13 (Open)](/task/004-task-13)

- [004 Task 14 (Open)](/task/004-task-14)

- [004 Task 01 (Open)](/task/004-task-01)

- [004 Task 02 (Open)](/task/004-task-02)

- [004 Task 03 (Open)](/task/004-task-03)

- [004 Task 04 (Open)](/task/004-task-04)

- [004 Task 05 (Open)](/task/004-task-05)

- [004 Task 06 (Open)](/task/004-task-06)

- [004 Task 07 (Open)](/task/004-task-07)

- [004 Task 08 (Open)](/task/004-task-08)

- [004 Task 09 (Open)](/task/004-task-09)

- [004 Task 15 (Open)](/task/004-task-15)'
alpine read /task/parent-004 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 004

- Status: Open

## Subtasks

- [004 Task 10 (Open)](/task/004-task-10)

- [004 Task 11 (Open)](/task/004-task-11)

- [004 Task 12 (Open)](/task/004-task-12)

- [004 Task 13 (Open)](/task/004-task-13)

- [004 Task 14 (Open)](/task/004-task-14)

- [004 Task 01 (Open)](/task/004-task-01)

- [004 Task 02 (Open)](/task/004-task-02)

- [004 Task 03 (Open)](/task/004-task-03)

- [004 Task 04 (Open)](/task/004-task-04)

- [004 Task 05 (Open)](/task/004-task-05)

- [004 Task 06 (Open)](/task/004-task-06)

- [004 Task 07 (Open)](/task/004-task-07)

- [004 Task 08 (Open)](/task/004-task-08)

- [004 Task 09 (Open)](/task/004-task-09)

- [004 Task 15 (Open)](/task/004-task-15)
`);
});

test("one newly created task to start; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 005

## Subtasks

- 005 Task 01 (Open)
- 005 Task 02 (Open)
- 005 Task 03 (Open)
- 005 Task 04 (Open)
- 005 Task 05 (Open)
- 005 Task 06 (Open)
- 005 Task 07 (Open)
- 005 Task 08 (Open)
- 005 Task 09 (Open)
- 005 Task 10 (Open)
- 005 Task 11 (Open)
- 005 Task 12 (Open)
- 005 Task 13 (Open)
- 005 Task 14 (Open)
- 005 Task 15 (Open)
- 005 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 005](/task/parent-005).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-005/subtasks --limit 850b >/dev/null
alpine update /task/parent-005/subtasks \\
  --old '- [005 Task 01 (Open)](/task/005-task-01)

- [005 Task 02 (Open)](/task/005-task-02)

- [005 Task 03 (Open)](/task/005-task-03)

- [005 Task 04 (Open)](/task/005-task-04)

- [005 Task 05 (Open)](/task/005-task-05)

- [005 Task 06 (Open)](/task/005-task-06)

- [005 Task 07 (Open)](/task/005-task-07)

- [005 Task 08 (Open)](/task/005-task-08)

- [005 Task 09 (Open)](/task/005-task-09)

- [005 Task 10 (Open)](/task/005-task-10)

- [005 Task 11 (Open)](/task/005-task-11)

- [005 Task 12 (Open)](/task/005-task-12)

- [005 Task 13 (Open)](/task/005-task-13)

- [005 Task 14 (Open)](/task/005-task-14)

- [005 Task 15 (Open)](/task/005-task-15)' \\
  --new '- 005 Moved new 1 (Open)

- [005 Task 01 (Open)](/task/005-task-01)

- [005 Task 02 (Open)](/task/005-task-02)

- [005 Task 03 (Open)](/task/005-task-03)

- [005 Task 04 (Open)](/task/005-task-04)

- [005 Task 05 (Open)](/task/005-task-05)

- [005 Task 06 (Open)](/task/005-task-06)

- [005 Task 07 (Open)](/task/005-task-07)

- [005 Task 08 (Open)](/task/005-task-08)

- [005 Task 09 (Open)](/task/005-task-09)

- [005 Task 10 (Open)](/task/005-task-10)

- [005 Task 11 (Open)](/task/005-task-11)

- [005 Task 12 (Open)](/task/005-task-12)

- [005 Task 13 (Open)](/task/005-task-13)

- [005 Task 14 (Open)](/task/005-task-14)

- [005 Task 15 (Open)](/task/005-task-15)'
alpine read /task/parent-005/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 005 (Open)](/task/parent-005).

- [005 Moved new 1 (Open)](/task/005-moved-new-1)

- [005 Task 01 (Open)](/task/005-task-01)

- [005 Task 02 (Open)](/task/005-task-02)

- [005 Task 03 (Open)](/task/005-task-03)

- [005 Task 04 (Open)](/task/005-task-04)

- [005 Task 05 (Open)](/task/005-task-05)

- [005 Task 06 (Open)](/task/005-task-06)

- [005 Task 07 (Open)](/task/005-task-07)

- [005 Task 08 (Open)](/task/005-task-08)

- [005 Task 09 (Open)](/task/005-task-09)

- [005 Task 10 (Open)](/task/005-task-10)

- [005 Task 11 (Open)](/task/005-task-11)

- [005 Task 12 (Open)](/task/005-task-12)

- [005 Task 13 (Open)](/task/005-task-13)

- [005 Task 14 (Open)](/task/005-task-14)

- [005 Task 15 (Open)](/task/005-task-15)

- [005 After pagination guard with a deliberately long title (Open)](/task/005-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two newly created tasks to start; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 006

## Subtasks

- 006 Before (Open)
- 006 Task 01 (Open)
- 006 Task 02 (Open)
- 006 Task 03 (Open)
- 006 Task 04 (Open)
- 006 Task 05 (Open)
- 006 Task 06 (Open)
- 006 Task 07 (Open)
- 006 Task 08 (Open)
- 006 Task 09 (Open)
- 006 Task 10 (Open)
- 006 Task 11 (Open)
- 006 Task 12 (Open)
- 006 Task 13 (Open)
- 006 Task 14 (Open)
- 006 Task 15 (Open)
- 006 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 006](/task/parent-006).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-006/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [006 Task 01 (Open)](/task/006-task-01)

- [006 Task 02 (Open)](/task/006-task-02)

- [006 Task 03 (Open)](/task/006-task-03)

- [006 Task 04 (Open)](/task/006-task-04)

- [006 Task 05 (Open)](/task/006-task-05)

- [006 Task 06 (Open)](/task/006-task-06)

- [006 Task 07 (Open)](/task/006-task-07)

- [006 Task 08 (Open)](/task/006-task-08)

- [006 Task 09 (Open)](/task/006-task-09)

- [006 Task 10 (Open)](/task/006-task-10)

- [006 Task 11 (Open)](/task/006-task-11)

- [006 Task 12 (Open)](/task/006-task-12)

- [006 Task 13 (Open)](/task/006-task-13)

- [006 Task 14 (Open)](/task/006-task-14)

- [006 Task 15 (Open)](/task/006-task-15)' \\
  --new '- 006 Moved new 1 (Open)

- 006 Moved new 2 (Open)

- [006 Task 01 (Open)](/task/006-task-01)

- [006 Task 02 (Open)](/task/006-task-02)

- [006 Task 03 (Open)](/task/006-task-03)

- [006 Task 04 (Open)](/task/006-task-04)

- [006 Task 05 (Open)](/task/006-task-05)

- [006 Task 06 (Open)](/task/006-task-06)

- [006 Task 07 (Open)](/task/006-task-07)

- [006 Task 08 (Open)](/task/006-task-08)

- [006 Task 09 (Open)](/task/006-task-09)

- [006 Task 10 (Open)](/task/006-task-10)

- [006 Task 11 (Open)](/task/006-task-11)

- [006 Task 12 (Open)](/task/006-task-12)

- [006 Task 13 (Open)](/task/006-task-13)

- [006 Task 14 (Open)](/task/006-task-14)

- [006 Task 15 (Open)](/task/006-task-15)'
alpine read /task/parent-006/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 006 (Open)](/task/parent-006).

- [006 Before (Open)](/task/006-before)

- [006 Moved new 1 (Open)](/task/006-moved-new-1)

- [006 Moved new 2 (Open)](/task/006-moved-new-2)

- [006 Task 01 (Open)](/task/006-task-01)

- [006 Task 02 (Open)](/task/006-task-02)

- [006 Task 03 (Open)](/task/006-task-03)

- [006 Task 04 (Open)](/task/006-task-04)

- [006 Task 05 (Open)](/task/006-task-05)

- [006 Task 06 (Open)](/task/006-task-06)

- [006 Task 07 (Open)](/task/006-task-07)

- [006 Task 08 (Open)](/task/006-task-08)

- [006 Task 09 (Open)](/task/006-task-09)

- [006 Task 10 (Open)](/task/006-task-10)

- [006 Task 11 (Open)](/task/006-task-11)

- [006 Task 12 (Open)](/task/006-task-12)

- [006 Task 13 (Open)](/task/006-task-13)

- [006 Task 14 (Open)](/task/006-task-14)

- [006 Task 15 (Open)](/task/006-task-15)

- [006 After pagination guard with a deliberately long title (Open)](/task/006-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five newly created tasks to start; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 007

## Subtasks

- 007 Before (Open)
- 007 Task 01 (Open)
- 007 Task 02 (Open)
- 007 Task 03 (Open)
- 007 Task 04 (Open)
- 007 Task 05 (Open)
- 007 Task 06 (Open)
- 007 Task 07 (Open)
- 007 Task 08 (Open)
- 007 Task 09 (Open)
- 007 Task 10 (Open)
- 007 Task 11 (Open)
- 007 Task 12 (Open)
- 007 Task 13 (Open)
- 007 Task 14 (Open)
- 007 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 007](/task/parent-007).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-007/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [007 Task 01 (Open)](/task/007-task-01)

- [007 Task 02 (Open)](/task/007-task-02)

- [007 Task 03 (Open)](/task/007-task-03)

- [007 Task 04 (Open)](/task/007-task-04)

- [007 Task 05 (Open)](/task/007-task-05)

- [007 Task 06 (Open)](/task/007-task-06)

- [007 Task 07 (Open)](/task/007-task-07)

- [007 Task 08 (Open)](/task/007-task-08)

- [007 Task 09 (Open)](/task/007-task-09)

- [007 Task 10 (Open)](/task/007-task-10)

- [007 Task 11 (Open)](/task/007-task-11)

- [007 Task 12 (Open)](/task/007-task-12)

- [007 Task 13 (Open)](/task/007-task-13)

- [007 Task 14 (Open)](/task/007-task-14)

- [007 Task 15 (Open)](/task/007-task-15)' \\
  --new '- 007 Moved new 1 (Open)

- 007 Moved new 2 (Open)

- 007 Moved new 3 (Open)

- 007 Moved new 4 (Open)

- 007 Moved new 5 (Open)

- [007 Task 01 (Open)](/task/007-task-01)

- [007 Task 02 (Open)](/task/007-task-02)

- [007 Task 03 (Open)](/task/007-task-03)

- [007 Task 04 (Open)](/task/007-task-04)

- [007 Task 05 (Open)](/task/007-task-05)

- [007 Task 06 (Open)](/task/007-task-06)

- [007 Task 07 (Open)](/task/007-task-07)

- [007 Task 08 (Open)](/task/007-task-08)

- [007 Task 09 (Open)](/task/007-task-09)

- [007 Task 10 (Open)](/task/007-task-10)

- [007 Task 11 (Open)](/task/007-task-11)

- [007 Task 12 (Open)](/task/007-task-12)

- [007 Task 13 (Open)](/task/007-task-13)

- [007 Task 14 (Open)](/task/007-task-14)

- [007 Task 15 (Open)](/task/007-task-15)'
alpine read /task/parent-007/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 007 (Open)](/task/parent-007).

- [007 Before (Open)](/task/007-before)

- [007 Moved new 1 (Open)](/task/007-moved-new-1)

- [007 Moved new 2 (Open)](/task/007-moved-new-2)

- [007 Moved new 3 (Open)](/task/007-moved-new-3)

- [007 Moved new 4 (Open)](/task/007-moved-new-4)

- [007 Moved new 5 (Open)](/task/007-moved-new-5)

- [007 Task 01 (Open)](/task/007-task-01)

- [007 Task 02 (Open)](/task/007-task-02)

- [007 Task 03 (Open)](/task/007-task-03)

- [007 Task 04 (Open)](/task/007-task-04)

- [007 Task 05 (Open)](/task/007-task-05)

- [007 Task 06 (Open)](/task/007-task-06)

- [007 Task 07 (Open)](/task/007-task-07)

- [007 Task 08 (Open)](/task/007-task-08)

- [007 Task 09 (Open)](/task/007-task-09)

- [007 Task 10 (Open)](/task/007-task-10)

- [007 Task 11 (Open)](/task/007-task-11)

- [007 Task 12 (Open)](/task/007-task-12)

- [007 Task 13 (Open)](/task/007-task-13)

- [007 Task 14 (Open)](/task/007-task-14)

- [007 Task 15 (Open)](/task/007-task-15)

End of tasks.
`);
});

test("one task created by the previous update to start; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 008

- 008 Task 01 (Open)
- 008 Task 02 (Open)
- 008 Task 03 (Open)
- 008 Task 04 (Open)
- 008 Task 05 (Open)
- 008 Task 06 (Open)
- 008 Task 07 (Open)
- 008 Task 08 (Open)
- 008 Task 09 (Open)
- 008 Task 10 (Open)
- 008 Task 11 (Open)
- 008 Task 12 (Open)
- 008 Task 13 (Open)
- 008 Task 14 (Open)
- 008 Task 15 (Open)
- 008 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 008](/task-collection/roadmap-008).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-008 --limit 850b >/dev/null
alpine update /task-collection/roadmap-008 \\
  --old '- [008 Task 01 (Open)](/task/008-task-01)

- [008 Task 02 (Open)](/task/008-task-02)

- [008 Task 03 (Open)](/task/008-task-03)

- [008 Task 04 (Open)](/task/008-task-04)

- [008 Task 05 (Open)](/task/008-task-05)

- [008 Task 06 (Open)](/task/008-task-06)

- [008 Task 07 (Open)](/task/008-task-07)

- [008 Task 08 (Open)](/task/008-task-08)

- [008 Task 09 (Open)](/task/008-task-09)

- [008 Task 10 (Open)](/task/008-task-10)

- [008 Task 11 (Open)](/task/008-task-11)

- [008 Task 12 (Open)](/task/008-task-12)

- [008 Task 13 (Open)](/task/008-task-13)

- [008 Task 14 (Open)](/task/008-task-14)

- [008 Task 15 (Open)](/task/008-task-15)' \\
  --new '- [008 Task 01 (Open)](/task/008-task-01)

- [008 Task 02 (Open)](/task/008-task-02)

- [008 Task 03 (Open)](/task/008-task-03)

- [008 Task 04 (Open)](/task/008-task-04)

- [008 Task 05 (Open)](/task/008-task-05)

- [008 Task 06 (Open)](/task/008-task-06)

- [008 Task 07 (Open)](/task/008-task-07)

- [008 Task 08 (Open)](/task/008-task-08)

- [008 Task 09 (Open)](/task/008-task-09)

- [008 Task 10 (Open)](/task/008-task-10)

- 008 Moved previous 1 (Open)

- [008 Task 11 (Open)](/task/008-task-11)

- [008 Task 12 (Open)](/task/008-task-12)

- [008 Task 13 (Open)](/task/008-task-13)

- [008 Task 14 (Open)](/task/008-task-14)

- [008 Task 15 (Open)](/task/008-task-15)'
alpine update /task-collection/roadmap-008 \\
  --old '- [008 Task 01 (Open)](/task/008-task-01)

- [008 Task 02 (Open)](/task/008-task-02)

- [008 Task 03 (Open)](/task/008-task-03)

- [008 Task 04 (Open)](/task/008-task-04)

- [008 Task 05 (Open)](/task/008-task-05)

- [008 Task 06 (Open)](/task/008-task-06)

- [008 Task 07 (Open)](/task/008-task-07)

- [008 Task 08 (Open)](/task/008-task-08)

- [008 Task 09 (Open)](/task/008-task-09)

- [008 Task 10 (Open)](/task/008-task-10)

- 008 Moved previous 1 (Open)

- [008 Task 11 (Open)](/task/008-task-11)

- [008 Task 12 (Open)](/task/008-task-12)

- [008 Task 13 (Open)](/task/008-task-13)

- [008 Task 14 (Open)](/task/008-task-14)

- [008 Task 15 (Open)](/task/008-task-15)' \\
  --new '- 008 Moved previous 1 (Open)

- [008 Task 01 (Open)](/task/008-task-01)

- [008 Task 02 (Open)](/task/008-task-02)

- [008 Task 03 (Open)](/task/008-task-03)

- [008 Task 04 (Open)](/task/008-task-04)

- [008 Task 05 (Open)](/task/008-task-05)

- [008 Task 06 (Open)](/task/008-task-06)

- [008 Task 07 (Open)](/task/008-task-07)

- [008 Task 08 (Open)](/task/008-task-08)

- [008 Task 09 (Open)](/task/008-task-09)

- [008 Task 10 (Open)](/task/008-task-10)

- [008 Task 11 (Open)](/task/008-task-11)

- [008 Task 12 (Open)](/task/008-task-12)

- [008 Task 13 (Open)](/task/008-task-13)

- [008 Task 14 (Open)](/task/008-task-14)

- [008 Task 15 (Open)](/task/008-task-15)'
alpine read /task-collection/roadmap-008 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 008

- [008 Moved previous 1 (Open)](/task/008-moved-previous-1)

- [008 Task 01 (Open)](/task/008-task-01)

- [008 Task 02 (Open)](/task/008-task-02)

- [008 Task 03 (Open)](/task/008-task-03)

- [008 Task 04 (Open)](/task/008-task-04)

- [008 Task 05 (Open)](/task/008-task-05)

- [008 Task 06 (Open)](/task/008-task-06)

- [008 Task 07 (Open)](/task/008-task-07)

- [008 Task 08 (Open)](/task/008-task-08)

- [008 Task 09 (Open)](/task/008-task-09)

- [008 Task 10 (Open)](/task/008-task-10)

- [008 Task 11 (Open)](/task/008-task-11)

- [008 Task 12 (Open)](/task/008-task-12)

- [008 Task 13 (Open)](/task/008-task-13)

- [008 Task 14 (Open)](/task/008-task-14)

- [008 Task 15 (Open)](/task/008-task-15)

- [008 After pagination guard with a deliberately long title (Open)](/task/008-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two tasks created by the previous update to start; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 009

- 009 Before (Open)
- 009 Task 01 (Open)
- 009 Task 02 (Open)
- 009 Task 03 (Open)
- 009 Task 04 (Open)
- 009 Task 05 (Open)
- 009 Task 06 (Open)
- 009 Task 07 (Open)
- 009 Task 08 (Open)
- 009 Task 09 (Open)
- 009 Task 10 (Open)
- 009 Task 11 (Open)
- 009 Task 12 (Open)
- 009 Task 13 (Open)
- 009 Task 14 (Open)
- 009 Task 15 (Open)
- 009 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 009](/task-collection/roadmap-009).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-009 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [009 Task 01 (Open)](/task/009-task-01)

- [009 Task 02 (Open)](/task/009-task-02)

- [009 Task 03 (Open)](/task/009-task-03)

- [009 Task 04 (Open)](/task/009-task-04)

- [009 Task 05 (Open)](/task/009-task-05)

- [009 Task 06 (Open)](/task/009-task-06)

- [009 Task 07 (Open)](/task/009-task-07)

- [009 Task 08 (Open)](/task/009-task-08)

- [009 Task 09 (Open)](/task/009-task-09)

- [009 Task 10 (Open)](/task/009-task-10)

- [009 Task 11 (Open)](/task/009-task-11)

- [009 Task 12 (Open)](/task/009-task-12)

- [009 Task 13 (Open)](/task/009-task-13)

- [009 Task 14 (Open)](/task/009-task-14)

- [009 Task 15 (Open)](/task/009-task-15)' \\
  --new '- [009 Task 01 (Open)](/task/009-task-01)

- [009 Task 02 (Open)](/task/009-task-02)

- [009 Task 03 (Open)](/task/009-task-03)

- [009 Task 04 (Open)](/task/009-task-04)

- [009 Task 05 (Open)](/task/009-task-05)

- [009 Task 06 (Open)](/task/009-task-06)

- [009 Task 07 (Open)](/task/009-task-07)

- [009 Task 08 (Open)](/task/009-task-08)

- [009 Task 09 (Open)](/task/009-task-09)

- [009 Task 10 (Open)](/task/009-task-10)

- 009 Moved previous 1 (Open)

- 009 Moved previous 2 (Open)

- [009 Task 11 (Open)](/task/009-task-11)

- [009 Task 12 (Open)](/task/009-task-12)

- [009 Task 13 (Open)](/task/009-task-13)

- [009 Task 14 (Open)](/task/009-task-14)

- [009 Task 15 (Open)](/task/009-task-15)'
alpine update $path \\
  --old '- [009 Task 01 (Open)](/task/009-task-01)

- [009 Task 02 (Open)](/task/009-task-02)

- [009 Task 03 (Open)](/task/009-task-03)

- [009 Task 04 (Open)](/task/009-task-04)

- [009 Task 05 (Open)](/task/009-task-05)

- [009 Task 06 (Open)](/task/009-task-06)

- [009 Task 07 (Open)](/task/009-task-07)

- [009 Task 08 (Open)](/task/009-task-08)

- [009 Task 09 (Open)](/task/009-task-09)

- [009 Task 10 (Open)](/task/009-task-10)

- 009 Moved previous 1 (Open)

- 009 Moved previous 2 (Open)

- [009 Task 11 (Open)](/task/009-task-11)

- [009 Task 12 (Open)](/task/009-task-12)

- [009 Task 13 (Open)](/task/009-task-13)

- [009 Task 14 (Open)](/task/009-task-14)

- [009 Task 15 (Open)](/task/009-task-15)' \\
  --new '- 009 Moved previous 1 (Open)

- 009 Moved previous 2 (Open)

- [009 Task 01 (Open)](/task/009-task-01)

- [009 Task 02 (Open)](/task/009-task-02)

- [009 Task 03 (Open)](/task/009-task-03)

- [009 Task 04 (Open)](/task/009-task-04)

- [009 Task 05 (Open)](/task/009-task-05)

- [009 Task 06 (Open)](/task/009-task-06)

- [009 Task 07 (Open)](/task/009-task-07)

- [009 Task 08 (Open)](/task/009-task-08)

- [009 Task 09 (Open)](/task/009-task-09)

- [009 Task 10 (Open)](/task/009-task-10)

- [009 Task 11 (Open)](/task/009-task-11)

- [009 Task 12 (Open)](/task/009-task-12)

- [009 Task 13 (Open)](/task/009-task-13)

- [009 Task 14 (Open)](/task/009-task-14)

- [009 Task 15 (Open)](/task/009-task-15)'
alpine read /task-collection/roadmap-009 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 009

- [009 Before (Open)](/task/009-before)

- [009 Moved previous 1 (Open)](/task/009-moved-previous-1)

- [009 Moved previous 2 (Open)](/task/009-moved-previous-2)

- [009 Task 01 (Open)](/task/009-task-01)

- [009 Task 02 (Open)](/task/009-task-02)

- [009 Task 03 (Open)](/task/009-task-03)

- [009 Task 04 (Open)](/task/009-task-04)

- [009 Task 05 (Open)](/task/009-task-05)

- [009 Task 06 (Open)](/task/009-task-06)

- [009 Task 07 (Open)](/task/009-task-07)

- [009 Task 08 (Open)](/task/009-task-08)

- [009 Task 09 (Open)](/task/009-task-09)

- [009 Task 10 (Open)](/task/009-task-10)

- [009 Task 11 (Open)](/task/009-task-11)

- [009 Task 12 (Open)](/task/009-task-12)

- [009 Task 13 (Open)](/task/009-task-13)

- [009 Task 14 (Open)](/task/009-task-14)

- [009 Task 15 (Open)](/task/009-task-15)

- [009 After pagination guard with a deliberately long title (Open)](/task/009-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five tasks created by the previous update to start; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 010

- 010 Before (Open)
- 010 Task 01 (Open)
- 010 Task 02 (Open)
- 010 Task 03 (Open)
- 010 Task 04 (Open)
- 010 Task 05 (Open)
- 010 Task 06 (Open)
- 010 Task 07 (Open)
- 010 Task 08 (Open)
- 010 Task 09 (Open)
- 010 Task 10 (Open)
- 010 Task 11 (Open)
- 010 Task 12 (Open)
- 010 Task 13 (Open)
- 010 Task 14 (Open)
- 010 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 010](/task-collection/roadmap-010).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-010 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [010 Task 01 (Open)](/task/010-task-01)

- [010 Task 02 (Open)](/task/010-task-02)

- [010 Task 03 (Open)](/task/010-task-03)

- [010 Task 04 (Open)](/task/010-task-04)

- [010 Task 05 (Open)](/task/010-task-05)

- [010 Task 06 (Open)](/task/010-task-06)

- [010 Task 07 (Open)](/task/010-task-07)

- [010 Task 08 (Open)](/task/010-task-08)

- [010 Task 09 (Open)](/task/010-task-09)

- [010 Task 10 (Open)](/task/010-task-10)

- [010 Task 11 (Open)](/task/010-task-11)

- [010 Task 12 (Open)](/task/010-task-12)

- [010 Task 13 (Open)](/task/010-task-13)

- [010 Task 14 (Open)](/task/010-task-14)

- [010 Task 15 (Open)](/task/010-task-15)' \\
  --new '- [010 Task 01 (Open)](/task/010-task-01)

- [010 Task 02 (Open)](/task/010-task-02)

- [010 Task 03 (Open)](/task/010-task-03)

- [010 Task 04 (Open)](/task/010-task-04)

- [010 Task 05 (Open)](/task/010-task-05)

- [010 Task 06 (Open)](/task/010-task-06)

- [010 Task 07 (Open)](/task/010-task-07)

- [010 Task 08 (Open)](/task/010-task-08)

- [010 Task 09 (Open)](/task/010-task-09)

- [010 Task 10 (Open)](/task/010-task-10)

- 010 Moved previous 1 (Open)

- 010 Moved previous 2 (Open)

- 010 Moved previous 3 (Open)

- 010 Moved previous 4 (Open)

- 010 Moved previous 5 (Open)

- [010 Task 11 (Open)](/task/010-task-11)

- [010 Task 12 (Open)](/task/010-task-12)

- [010 Task 13 (Open)](/task/010-task-13)

- [010 Task 14 (Open)](/task/010-task-14)

- [010 Task 15 (Open)](/task/010-task-15)'
alpine update $path \\
  --old '- [010 Task 01 (Open)](/task/010-task-01)

- [010 Task 02 (Open)](/task/010-task-02)

- [010 Task 03 (Open)](/task/010-task-03)

- [010 Task 04 (Open)](/task/010-task-04)

- [010 Task 05 (Open)](/task/010-task-05)

- [010 Task 06 (Open)](/task/010-task-06)

- [010 Task 07 (Open)](/task/010-task-07)

- [010 Task 08 (Open)](/task/010-task-08)

- [010 Task 09 (Open)](/task/010-task-09)

- [010 Task 10 (Open)](/task/010-task-10)

- 010 Moved previous 1 (Open)

- 010 Moved previous 2 (Open)

- 010 Moved previous 3 (Open)

- 010 Moved previous 4 (Open)

- 010 Moved previous 5 (Open)

- [010 Task 11 (Open)](/task/010-task-11)

- [010 Task 12 (Open)](/task/010-task-12)

- [010 Task 13 (Open)](/task/010-task-13)

- [010 Task 14 (Open)](/task/010-task-14)

- [010 Task 15 (Open)](/task/010-task-15)' \\
  --new '- 010 Moved previous 1 (Open)

- 010 Moved previous 2 (Open)

- 010 Moved previous 3 (Open)

- 010 Moved previous 4 (Open)

- 010 Moved previous 5 (Open)

- [010 Task 01 (Open)](/task/010-task-01)

- [010 Task 02 (Open)](/task/010-task-02)

- [010 Task 03 (Open)](/task/010-task-03)

- [010 Task 04 (Open)](/task/010-task-04)

- [010 Task 05 (Open)](/task/010-task-05)

- [010 Task 06 (Open)](/task/010-task-06)

- [010 Task 07 (Open)](/task/010-task-07)

- [010 Task 08 (Open)](/task/010-task-08)

- [010 Task 09 (Open)](/task/010-task-09)

- [010 Task 10 (Open)](/task/010-task-10)

- [010 Task 11 (Open)](/task/010-task-11)

- [010 Task 12 (Open)](/task/010-task-12)

- [010 Task 13 (Open)](/task/010-task-13)

- [010 Task 14 (Open)](/task/010-task-14)

- [010 Task 15 (Open)](/task/010-task-15)'
alpine read /task-collection/roadmap-010 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 010

- [010 Before (Open)](/task/010-before)

- [010 Moved previous 1 (Open)](/task/010-moved-previous-1)

- [010 Moved previous 2 (Open)](/task/010-moved-previous-2)

- [010 Moved previous 3 (Open)](/task/010-moved-previous-3)

- [010 Moved previous 4 (Open)](/task/010-moved-previous-4)

- [010 Moved previous 5 (Open)](/task/010-moved-previous-5)

- [010 Task 01 (Open)](/task/010-task-01)

- [010 Task 02 (Open)](/task/010-task-02)

- [010 Task 03 (Open)](/task/010-task-03)

- [010 Task 04 (Open)](/task/010-task-04)

- [010 Task 05 (Open)](/task/010-task-05)

- [010 Task 06 (Open)](/task/010-task-06)

- [010 Task 07 (Open)](/task/010-task-07)

- [010 Task 08 (Open)](/task/010-task-08)

- [010 Task 09 (Open)](/task/010-task-09)

- [010 Task 10 (Open)](/task/010-task-10)

- [010 Task 11 (Open)](/task/010-task-11)

- [010 Task 12 (Open)](/task/010-task-12)

- [010 Task 13 (Open)](/task/010-task-13)

- [010 Task 14 (Open)](/task/010-task-14)

- [010 Task 15 (Open)](/task/010-task-15)

End of tasks.
`);
});

test("one existing then one newly created task to start; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 011

## Subtasks

- 011 Task 01 (Open)
- 011 Task 02 (Open)
- 011 Task 03 (Open)
- 011 Task 04 (Open)
- 011 Task 05 (Open)
- 011 Task 06 (Open)
- 011 Task 07 (Open)
- 011 Task 08 (Open)
- 011 Task 09 (Open)
- 011 Task 10 (Open)
- 011 Task 11 (Open)
- 011 Task 12 (Open)
- 011 Task 13 (Open)
- 011 Task 14 (Open)
- 011 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 011](/task/parent-011).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-011 --limit 100kb >/dev/null
alpine update /task/parent-011 \\
  --old '- [011 Task 01 (Open)](/task/011-task-01)

- [011 Task 02 (Open)](/task/011-task-02)

- [011 Task 03 (Open)](/task/011-task-03)

- [011 Task 04 (Open)](/task/011-task-04)

- [011 Task 05 (Open)](/task/011-task-05)

- [011 Task 06 (Open)](/task/011-task-06)

- [011 Task 07 (Open)](/task/011-task-07)

- [011 Task 08 (Open)](/task/011-task-08)

- [011 Task 09 (Open)](/task/011-task-09)

- [011 Task 10 (Open)](/task/011-task-10)

- [011 Task 11 (Open)](/task/011-task-11)

- [011 Task 12 (Open)](/task/011-task-12)

- [011 Task 13 (Open)](/task/011-task-13)

- [011 Task 14 (Open)](/task/011-task-14)

- [011 Task 15 (Open)](/task/011-task-15)' \\
  --new '- [011 Task 10 (Open)](/task/011-task-10)

- 011 Moved new 1 (Open)

- [011 Task 01 (Open)](/task/011-task-01)

- [011 Task 02 (Open)](/task/011-task-02)

- [011 Task 03 (Open)](/task/011-task-03)

- [011 Task 04 (Open)](/task/011-task-04)

- [011 Task 05 (Open)](/task/011-task-05)

- [011 Task 06 (Open)](/task/011-task-06)

- [011 Task 07 (Open)](/task/011-task-07)

- [011 Task 08 (Open)](/task/011-task-08)

- [011 Task 09 (Open)](/task/011-task-09)

- [011 Task 11 (Open)](/task/011-task-11)

- [011 Task 12 (Open)](/task/011-task-12)

- [011 Task 13 (Open)](/task/011-task-13)

- [011 Task 14 (Open)](/task/011-task-14)

- [011 Task 15 (Open)](/task/011-task-15)'
alpine read /task/parent-011 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 011

- Status: Open

## Subtasks

- [011 Task 10 (Open)](/task/011-task-10)

- [011 Moved new 1 (Open)](/task/011-moved-new-1)

- [011 Task 01 (Open)](/task/011-task-01)

- [011 Task 02 (Open)](/task/011-task-02)

- [011 Task 03 (Open)](/task/011-task-03)

- [011 Task 04 (Open)](/task/011-task-04)

- [011 Task 05 (Open)](/task/011-task-05)

- [011 Task 06 (Open)](/task/011-task-06)

- [011 Task 07 (Open)](/task/011-task-07)

- [011 Task 08 (Open)](/task/011-task-08)

- [011 Task 09 (Open)](/task/011-task-09)

- [011 Task 11 (Open)](/task/011-task-11)

- [011 Task 12 (Open)](/task/011-task-12)

- [011 Task 13 (Open)](/task/011-task-13)

- [011 Task 14 (Open)](/task/011-task-14)

- [011 Task 15 (Open)](/task/011-task-15)
`);
});

test("one newly created then one existing task to start; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 012

## Subtasks

- 012 Task 01 (Open)
- 012 Task 02 (Open)
- 012 Task 03 (Open)
- 012 Task 04 (Open)
- 012 Task 05 (Open)
- 012 Task 06 (Open)
- 012 Task 07 (Open)
- 012 Task 08 (Open)
- 012 Task 09 (Open)
- 012 Task 10 (Open)
- 012 Task 11 (Open)
- 012 Task 12 (Open)
- 012 Task 13 (Open)
- 012 Task 14 (Open)
- 012 Task 15 (Open)
- 012 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 012](/task/parent-012).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-012/subtasks --limit 850b >/dev/null
alpine update /task/parent-012/subtasks \\
  --old '- [012 Task 01 (Open)](/task/012-task-01)

- [012 Task 02 (Open)](/task/012-task-02)

- [012 Task 03 (Open)](/task/012-task-03)

- [012 Task 04 (Open)](/task/012-task-04)

- [012 Task 05 (Open)](/task/012-task-05)

- [012 Task 06 (Open)](/task/012-task-06)

- [012 Task 07 (Open)](/task/012-task-07)

- [012 Task 08 (Open)](/task/012-task-08)

- [012 Task 09 (Open)](/task/012-task-09)

- [012 Task 10 (Open)](/task/012-task-10)

- [012 Task 11 (Open)](/task/012-task-11)

- [012 Task 12 (Open)](/task/012-task-12)

- [012 Task 13 (Open)](/task/012-task-13)

- [012 Task 14 (Open)](/task/012-task-14)

- [012 Task 15 (Open)](/task/012-task-15)' \\
  --new '- 012 Moved new 1 (Open)

- [012 Task 10 (Open)](/task/012-task-10)

- [012 Task 01 (Open)](/task/012-task-01)

- [012 Task 02 (Open)](/task/012-task-02)

- [012 Task 03 (Open)](/task/012-task-03)

- [012 Task 04 (Open)](/task/012-task-04)

- [012 Task 05 (Open)](/task/012-task-05)

- [012 Task 06 (Open)](/task/012-task-06)

- [012 Task 07 (Open)](/task/012-task-07)

- [012 Task 08 (Open)](/task/012-task-08)

- [012 Task 09 (Open)](/task/012-task-09)

- [012 Task 11 (Open)](/task/012-task-11)

- [012 Task 12 (Open)](/task/012-task-12)

- [012 Task 13 (Open)](/task/012-task-13)

- [012 Task 14 (Open)](/task/012-task-14)

- [012 Task 15 (Open)](/task/012-task-15)'
alpine read /task/parent-012/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 012 (Open)](/task/parent-012).

- [012 Moved new 1 (Open)](/task/012-moved-new-1)

- [012 Task 10 (Open)](/task/012-task-10)

- [012 Task 01 (Open)](/task/012-task-01)

- [012 Task 02 (Open)](/task/012-task-02)

- [012 Task 03 (Open)](/task/012-task-03)

- [012 Task 04 (Open)](/task/012-task-04)

- [012 Task 05 (Open)](/task/012-task-05)

- [012 Task 06 (Open)](/task/012-task-06)

- [012 Task 07 (Open)](/task/012-task-07)

- [012 Task 08 (Open)](/task/012-task-08)

- [012 Task 09 (Open)](/task/012-task-09)

- [012 Task 11 (Open)](/task/012-task-11)

- [012 Task 12 (Open)](/task/012-task-12)

- [012 Task 13 (Open)](/task/012-task-13)

- [012 Task 14 (Open)](/task/012-task-14)

- [012 Task 15 (Open)](/task/012-task-15)

- [012 After pagination guard with a deliberately long title (Open)](/task/012-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing then three newly created tasks to start; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 013

## Subtasks

- 013 Before (Open)
- 013 Task 01 (Open)
- 013 Task 02 (Open)
- 013 Task 03 (Open)
- 013 Task 04 (Open)
- 013 Task 05 (Open)
- 013 Task 06 (Open)
- 013 Task 07 (Open)
- 013 Task 08 (Open)
- 013 Task 09 (Open)
- 013 Task 10 (Open)
- 013 Task 11 (Open)
- 013 Task 12 (Open)
- 013 Task 13 (Open)
- 013 Task 14 (Open)
- 013 Task 15 (Open)
- 013 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 013](/task/parent-013).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-013/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [013 Task 01 (Open)](/task/013-task-01)

- [013 Task 02 (Open)](/task/013-task-02)

- [013 Task 03 (Open)](/task/013-task-03)

- [013 Task 04 (Open)](/task/013-task-04)

- [013 Task 05 (Open)](/task/013-task-05)

- [013 Task 06 (Open)](/task/013-task-06)

- [013 Task 07 (Open)](/task/013-task-07)

- [013 Task 08 (Open)](/task/013-task-08)

- [013 Task 09 (Open)](/task/013-task-09)

- [013 Task 10 (Open)](/task/013-task-10)

- [013 Task 11 (Open)](/task/013-task-11)

- [013 Task 12 (Open)](/task/013-task-12)

- [013 Task 13 (Open)](/task/013-task-13)

- [013 Task 14 (Open)](/task/013-task-14)

- [013 Task 15 (Open)](/task/013-task-15)' \\
  --new '- [013 Task 10 (Open)](/task/013-task-10)

- [013 Task 11 (Open)](/task/013-task-11)

- 013 Moved new 1 (Open)

- 013 Moved new 2 (Open)

- 013 Moved new 3 (Open)

- [013 Task 01 (Open)](/task/013-task-01)

- [013 Task 02 (Open)](/task/013-task-02)

- [013 Task 03 (Open)](/task/013-task-03)

- [013 Task 04 (Open)](/task/013-task-04)

- [013 Task 05 (Open)](/task/013-task-05)

- [013 Task 06 (Open)](/task/013-task-06)

- [013 Task 07 (Open)](/task/013-task-07)

- [013 Task 08 (Open)](/task/013-task-08)

- [013 Task 09 (Open)](/task/013-task-09)

- [013 Task 12 (Open)](/task/013-task-12)

- [013 Task 13 (Open)](/task/013-task-13)

- [013 Task 14 (Open)](/task/013-task-14)

- [013 Task 15 (Open)](/task/013-task-15)'
alpine read /task/parent-013/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 013 (Open)](/task/parent-013).

- [013 Before (Open)](/task/013-before)

- [013 Task 10 (Open)](/task/013-task-10)

- [013 Task 11 (Open)](/task/013-task-11)

- [013 Moved new 1 (Open)](/task/013-moved-new-1)

- [013 Moved new 2 (Open)](/task/013-moved-new-2)

- [013 Moved new 3 (Open)](/task/013-moved-new-3)

- [013 Task 01 (Open)](/task/013-task-01)

- [013 Task 02 (Open)](/task/013-task-02)

- [013 Task 03 (Open)](/task/013-task-03)

- [013 Task 04 (Open)](/task/013-task-04)

- [013 Task 05 (Open)](/task/013-task-05)

- [013 Task 06 (Open)](/task/013-task-06)

- [013 Task 07 (Open)](/task/013-task-07)

- [013 Task 08 (Open)](/task/013-task-08)

- [013 Task 09 (Open)](/task/013-task-09)

- [013 Task 12 (Open)](/task/013-task-12)

- [013 Task 13 (Open)](/task/013-task-13)

- [013 Task 14 (Open)](/task/013-task-14)

- [013 Task 15 (Open)](/task/013-task-15)

- [013 After pagination guard with a deliberately long title (Open)](/task/013-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing and three newly created tasks interleaved to start; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 014

## Subtasks

- 014 Before (Open)
- 014 Task 01 (Open)
- 014 Task 02 (Open)
- 014 Task 03 (Open)
- 014 Task 04 (Open)
- 014 Task 05 (Open)
- 014 Task 06 (Open)
- 014 Task 07 (Open)
- 014 Task 08 (Open)
- 014 Task 09 (Open)
- 014 Task 10 (Open)
- 014 Task 11 (Open)
- 014 Task 12 (Open)
- 014 Task 13 (Open)
- 014 Task 14 (Open)
- 014 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 014](/task/parent-014).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-014/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [014 Task 01 (Open)](/task/014-task-01)

- [014 Task 02 (Open)](/task/014-task-02)

- [014 Task 03 (Open)](/task/014-task-03)

- [014 Task 04 (Open)](/task/014-task-04)

- [014 Task 05 (Open)](/task/014-task-05)

- [014 Task 06 (Open)](/task/014-task-06)

- [014 Task 07 (Open)](/task/014-task-07)

- [014 Task 08 (Open)](/task/014-task-08)

- [014 Task 09 (Open)](/task/014-task-09)

- [014 Task 10 (Open)](/task/014-task-10)

- [014 Task 11 (Open)](/task/014-task-11)

- [014 Task 12 (Open)](/task/014-task-12)

- [014 Task 13 (Open)](/task/014-task-13)

- [014 Task 14 (Open)](/task/014-task-14)

- [014 Task 15 (Open)](/task/014-task-15)' \\
  --new '- [014 Task 10 (Open)](/task/014-task-10)

- 014 Moved new 1 (Open)

- [014 Task 11 (Open)](/task/014-task-11)

- 014 Moved new 2 (Open)

- 014 Moved new 3 (Open)

- [014 Task 01 (Open)](/task/014-task-01)

- [014 Task 02 (Open)](/task/014-task-02)

- [014 Task 03 (Open)](/task/014-task-03)

- [014 Task 04 (Open)](/task/014-task-04)

- [014 Task 05 (Open)](/task/014-task-05)

- [014 Task 06 (Open)](/task/014-task-06)

- [014 Task 07 (Open)](/task/014-task-07)

- [014 Task 08 (Open)](/task/014-task-08)

- [014 Task 09 (Open)](/task/014-task-09)

- [014 Task 12 (Open)](/task/014-task-12)

- [014 Task 13 (Open)](/task/014-task-13)

- [014 Task 14 (Open)](/task/014-task-14)

- [014 Task 15 (Open)](/task/014-task-15)'
alpine read /task/parent-014/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 014 (Open)](/task/parent-014).

- [014 Before (Open)](/task/014-before)

- [014 Task 10 (Open)](/task/014-task-10)

- [014 Moved new 1 (Open)](/task/014-moved-new-1)

- [014 Task 11 (Open)](/task/014-task-11)

- [014 Moved new 2 (Open)](/task/014-moved-new-2)

- [014 Moved new 3 (Open)](/task/014-moved-new-3)

- [014 Task 01 (Open)](/task/014-task-01)

- [014 Task 02 (Open)](/task/014-task-02)

- [014 Task 03 (Open)](/task/014-task-03)

- [014 Task 04 (Open)](/task/014-task-04)

- [014 Task 05 (Open)](/task/014-task-05)

- [014 Task 06 (Open)](/task/014-task-06)

- [014 Task 07 (Open)](/task/014-task-07)

- [014 Task 08 (Open)](/task/014-task-08)

- [014 Task 09 (Open)](/task/014-task-09)

- [014 Task 12 (Open)](/task/014-task-12)

- [014 Task 13 (Open)](/task/014-task-13)

- [014 Task 14 (Open)](/task/014-task-14)

- [014 Task 15 (Open)](/task/014-task-15)

End of tasks.
`);
});

test("three newly created then two existing tasks to start; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 015

- 015 Task 01 (Open)
- 015 Task 02 (Open)
- 015 Task 03 (Open)
- 015 Task 04 (Open)
- 015 Task 05 (Open)
- 015 Task 06 (Open)
- 015 Task 07 (Open)
- 015 Task 08 (Open)
- 015 Task 09 (Open)
- 015 Task 10 (Open)
- 015 Task 11 (Open)
- 015 Task 12 (Open)
- 015 Task 13 (Open)
- 015 Task 14 (Open)
- 015 Task 15 (Open)
- 015 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 015](/task-collection/roadmap-015).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-015 --limit 850b >/dev/null
alpine update /task-collection/roadmap-015 \\
  --old '- [015 Task 01 (Open)](/task/015-task-01)

- [015 Task 02 (Open)](/task/015-task-02)

- [015 Task 03 (Open)](/task/015-task-03)

- [015 Task 04 (Open)](/task/015-task-04)

- [015 Task 05 (Open)](/task/015-task-05)

- [015 Task 06 (Open)](/task/015-task-06)

- [015 Task 07 (Open)](/task/015-task-07)

- [015 Task 08 (Open)](/task/015-task-08)

- [015 Task 09 (Open)](/task/015-task-09)

- [015 Task 10 (Open)](/task/015-task-10)

- [015 Task 11 (Open)](/task/015-task-11)

- [015 Task 12 (Open)](/task/015-task-12)

- [015 Task 13 (Open)](/task/015-task-13)

- [015 Task 14 (Open)](/task/015-task-14)

- [015 Task 15 (Open)](/task/015-task-15)' \\
  --new '- 015 Moved new 1 (Open)

- 015 Moved new 2 (Open)

- 015 Moved new 3 (Open)

- [015 Task 10 (Open)](/task/015-task-10)

- [015 Task 11 (Open)](/task/015-task-11)

- [015 Task 01 (Open)](/task/015-task-01)

- [015 Task 02 (Open)](/task/015-task-02)

- [015 Task 03 (Open)](/task/015-task-03)

- [015 Task 04 (Open)](/task/015-task-04)

- [015 Task 05 (Open)](/task/015-task-05)

- [015 Task 06 (Open)](/task/015-task-06)

- [015 Task 07 (Open)](/task/015-task-07)

- [015 Task 08 (Open)](/task/015-task-08)

- [015 Task 09 (Open)](/task/015-task-09)

- [015 Task 12 (Open)](/task/015-task-12)

- [015 Task 13 (Open)](/task/015-task-13)

- [015 Task 14 (Open)](/task/015-task-14)

- [015 Task 15 (Open)](/task/015-task-15)'
alpine read /task-collection/roadmap-015 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 015

- [015 Moved new 1 (Open)](/task/015-moved-new-1)

- [015 Moved new 2 (Open)](/task/015-moved-new-2)

- [015 Moved new 3 (Open)](/task/015-moved-new-3)

- [015 Task 10 (Open)](/task/015-task-10)

- [015 Task 11 (Open)](/task/015-task-11)

- [015 Task 01 (Open)](/task/015-task-01)

- [015 Task 02 (Open)](/task/015-task-02)

- [015 Task 03 (Open)](/task/015-task-03)

- [015 Task 04 (Open)](/task/015-task-04)

- [015 Task 05 (Open)](/task/015-task-05)

- [015 Task 06 (Open)](/task/015-task-06)

- [015 Task 07 (Open)](/task/015-task-07)

- [015 Task 08 (Open)](/task/015-task-08)

- [015 Task 09 (Open)](/task/015-task-09)

- [015 Task 12 (Open)](/task/015-task-12)

- [015 Task 13 (Open)](/task/015-task-13)

- [015 Task 14 (Open)](/task/015-task-14)

- [015 Task 15 (Open)](/task/015-task-15)

- [015 After pagination guard with a deliberately long title (Open)](/task/015-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 016

- 016 Before (Open)
- 016 Task 01 (Open)
- 016 Task 02 (Open)
- 016 Task 03 (Open)
- 016 Task 04 (Open)
- 016 Task 05 (Open)
- 016 Task 06 (Open)
- 016 Task 07 (Open)
- 016 Task 08 (Open)
- 016 Task 09 (Open)
- 016 Task 10 (Open)
- 016 Task 11 (Open)
- 016 Task 12 (Open)
- 016 Task 13 (Open)
- 016 Task 14 (Open)
- 016 Task 15 (Open)
- 016 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 016](/task-collection/roadmap-016).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-016 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [016 Task 01 (Open)](/task/016-task-01)

- [016 Task 02 (Open)](/task/016-task-02)

- [016 Task 03 (Open)](/task/016-task-03)

- [016 Task 04 (Open)](/task/016-task-04)

- [016 Task 05 (Open)](/task/016-task-05)

- [016 Task 06 (Open)](/task/016-task-06)

- [016 Task 07 (Open)](/task/016-task-07)

- [016 Task 08 (Open)](/task/016-task-08)

- [016 Task 09 (Open)](/task/016-task-09)

- [016 Task 10 (Open)](/task/016-task-10)

- [016 Task 11 (Open)](/task/016-task-11)

- [016 Task 12 (Open)](/task/016-task-12)

- [016 Task 13 (Open)](/task/016-task-13)

- [016 Task 14 (Open)](/task/016-task-14)

- [016 Task 15 (Open)](/task/016-task-15)' \\
  --new '- [016 Task 01 (Open)](/task/016-task-01)

- [016 Task 03 (Open)](/task/016-task-03)

- [016 Task 04 (Open)](/task/016-task-04)

- [016 Task 05 (Open)](/task/016-task-05)

- [016 Task 06 (Open)](/task/016-task-06)

- [016 Task 07 (Open)](/task/016-task-07)

- [016 Task 08 (Open)](/task/016-task-08)

- [016 Task 09 (Open)](/task/016-task-09)

- [016 Task 10 (Open)](/task/016-task-10)

- [016 Task 11 (Open)](/task/016-task-11)

- [016 Task 12 (Open)](/task/016-task-12)

- [016 Task 13 (Open)](/task/016-task-13)

- [016 Task 14 (Open)](/task/016-task-14)

- [016 Task 15 (Open)](/task/016-task-15)

- [016 Task 02 (Open)](/task/016-task-02)'
alpine read /task-collection/roadmap-016 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 016

- [016 Before (Open)](/task/016-before)

- [016 Task 01 (Open)](/task/016-task-01)

- [016 Task 03 (Open)](/task/016-task-03)

- [016 Task 04 (Open)](/task/016-task-04)

- [016 Task 05 (Open)](/task/016-task-05)

- [016 Task 06 (Open)](/task/016-task-06)

- [016 Task 07 (Open)](/task/016-task-07)

- [016 Task 08 (Open)](/task/016-task-08)

- [016 Task 09 (Open)](/task/016-task-09)

- [016 Task 10 (Open)](/task/016-task-10)

- [016 Task 11 (Open)](/task/016-task-11)

- [016 Task 12 (Open)](/task/016-task-12)

- [016 Task 13 (Open)](/task/016-task-13)

- [016 Task 14 (Open)](/task/016-task-14)

- [016 Task 15 (Open)](/task/016-task-15)

- [016 Task 02 (Open)](/task/016-task-02)

- [016 After pagination guard with a deliberately long title (Open)](/task/016-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two adjacent existing tasks to end; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 017

- 017 Before (Open)
- 017 Task 01 (Open)
- 017 Task 02 (Open)
- 017 Task 03 (Open)
- 017 Task 04 (Open)
- 017 Task 05 (Open)
- 017 Task 06 (Open)
- 017 Task 07 (Open)
- 017 Task 08 (Open)
- 017 Task 09 (Open)
- 017 Task 10 (Open)
- 017 Task 11 (Open)
- 017 Task 12 (Open)
- 017 Task 13 (Open)
- 017 Task 14 (Open)
- 017 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 017](/task-collection/roadmap-017).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-017 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [017 Task 01 (Open)](/task/017-task-01)

- [017 Task 02 (Open)](/task/017-task-02)

- [017 Task 03 (Open)](/task/017-task-03)

- [017 Task 04 (Open)](/task/017-task-04)

- [017 Task 05 (Open)](/task/017-task-05)

- [017 Task 06 (Open)](/task/017-task-06)

- [017 Task 07 (Open)](/task/017-task-07)

- [017 Task 08 (Open)](/task/017-task-08)

- [017 Task 09 (Open)](/task/017-task-09)

- [017 Task 10 (Open)](/task/017-task-10)

- [017 Task 11 (Open)](/task/017-task-11)

- [017 Task 12 (Open)](/task/017-task-12)

- [017 Task 13 (Open)](/task/017-task-13)

- [017 Task 14 (Open)](/task/017-task-14)

- [017 Task 15 (Open)](/task/017-task-15)' \\
  --new '- [017 Task 01 (Open)](/task/017-task-01)

- [017 Task 04 (Open)](/task/017-task-04)

- [017 Task 05 (Open)](/task/017-task-05)

- [017 Task 06 (Open)](/task/017-task-06)

- [017 Task 07 (Open)](/task/017-task-07)

- [017 Task 08 (Open)](/task/017-task-08)

- [017 Task 09 (Open)](/task/017-task-09)

- [017 Task 10 (Open)](/task/017-task-10)

- [017 Task 11 (Open)](/task/017-task-11)

- [017 Task 12 (Open)](/task/017-task-12)

- [017 Task 13 (Open)](/task/017-task-13)

- [017 Task 14 (Open)](/task/017-task-14)

- [017 Task 15 (Open)](/task/017-task-15)

- [017 Task 02 (Open)](/task/017-task-02)

- [017 Task 03 (Open)](/task/017-task-03)'
alpine read /task-collection/roadmap-017 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 017

- [017 Before (Open)](/task/017-before)

- [017 Task 01 (Open)](/task/017-task-01)

- [017 Task 04 (Open)](/task/017-task-04)

- [017 Task 05 (Open)](/task/017-task-05)

- [017 Task 06 (Open)](/task/017-task-06)

- [017 Task 07 (Open)](/task/017-task-07)

- [017 Task 08 (Open)](/task/017-task-08)

- [017 Task 09 (Open)](/task/017-task-09)

- [017 Task 10 (Open)](/task/017-task-10)

- [017 Task 11 (Open)](/task/017-task-11)

- [017 Task 12 (Open)](/task/017-task-12)

- [017 Task 13 (Open)](/task/017-task-13)

- [017 Task 14 (Open)](/task/017-task-14)

- [017 Task 15 (Open)](/task/017-task-15)

- [017 Task 02 (Open)](/task/017-task-02)

- [017 Task 03 (Open)](/task/017-task-03)

End of tasks.
`);
});

test("two non-adjacent existing tasks to end; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 018

## Subtasks

- 018 Task 01 (Open)
- 018 Task 02 (Open)
- 018 Task 03 (Open)
- 018 Task 04 (Open)
- 018 Task 05 (Open)
- 018 Task 06 (Open)
- 018 Task 07 (Open)
- 018 Task 08 (Open)
- 018 Task 09 (Open)
- 018 Task 10 (Open)
- 018 Task 11 (Open)
- 018 Task 12 (Open)
- 018 Task 13 (Open)
- 018 Task 14 (Open)
- 018 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 018](/task/parent-018).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-018 --limit 100kb >/dev/null
alpine update /task/parent-018 \\
  --old '- [018 Task 01 (Open)](/task/018-task-01)

- [018 Task 02 (Open)](/task/018-task-02)

- [018 Task 03 (Open)](/task/018-task-03)

- [018 Task 04 (Open)](/task/018-task-04)

- [018 Task 05 (Open)](/task/018-task-05)

- [018 Task 06 (Open)](/task/018-task-06)

- [018 Task 07 (Open)](/task/018-task-07)

- [018 Task 08 (Open)](/task/018-task-08)

- [018 Task 09 (Open)](/task/018-task-09)

- [018 Task 10 (Open)](/task/018-task-10)

- [018 Task 11 (Open)](/task/018-task-11)

- [018 Task 12 (Open)](/task/018-task-12)

- [018 Task 13 (Open)](/task/018-task-13)

- [018 Task 14 (Open)](/task/018-task-14)

- [018 Task 15 (Open)](/task/018-task-15)' \\
  --new '- [018 Task 01 (Open)](/task/018-task-01)

- [018 Task 03 (Open)](/task/018-task-03)

- [018 Task 04 (Open)](/task/018-task-04)

- [018 Task 06 (Open)](/task/018-task-06)

- [018 Task 07 (Open)](/task/018-task-07)

- [018 Task 08 (Open)](/task/018-task-08)

- [018 Task 09 (Open)](/task/018-task-09)

- [018 Task 10 (Open)](/task/018-task-10)

- [018 Task 11 (Open)](/task/018-task-11)

- [018 Task 12 (Open)](/task/018-task-12)

- [018 Task 13 (Open)](/task/018-task-13)

- [018 Task 14 (Open)](/task/018-task-14)

- [018 Task 15 (Open)](/task/018-task-15)

- [018 Task 02 (Open)](/task/018-task-02)

- [018 Task 05 (Open)](/task/018-task-05)'
alpine read /task/parent-018 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 018

- Status: Open

## Subtasks

- [018 Task 01 (Open)](/task/018-task-01)

- [018 Task 03 (Open)](/task/018-task-03)

- [018 Task 04 (Open)](/task/018-task-04)

- [018 Task 06 (Open)](/task/018-task-06)

- [018 Task 07 (Open)](/task/018-task-07)

- [018 Task 08 (Open)](/task/018-task-08)

- [018 Task 09 (Open)](/task/018-task-09)

- [018 Task 10 (Open)](/task/018-task-10)

- [018 Task 11 (Open)](/task/018-task-11)

- [018 Task 12 (Open)](/task/018-task-12)

- [018 Task 13 (Open)](/task/018-task-13)

- [018 Task 14 (Open)](/task/018-task-14)

- [018 Task 15 (Open)](/task/018-task-15)

- [018 Task 02 (Open)](/task/018-task-02)

- [018 Task 05 (Open)](/task/018-task-05)
`);
});

test("five existing tasks to end; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 019

## Subtasks

- 019 Task 01 (Open)
- 019 Task 02 (Open)
- 019 Task 03 (Open)
- 019 Task 04 (Open)
- 019 Task 05 (Open)
- 019 Task 06 (Open)
- 019 Task 07 (Open)
- 019 Task 08 (Open)
- 019 Task 09 (Open)
- 019 Task 10 (Open)
- 019 Task 11 (Open)
- 019 Task 12 (Open)
- 019 Task 13 (Open)
- 019 Task 14 (Open)
- 019 Task 15 (Open)
- 019 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 019](/task/parent-019).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-019/subtasks --limit 850b >/dev/null
alpine update /task/parent-019/subtasks \\
  --old '- [019 Task 01 (Open)](/task/019-task-01)

- [019 Task 02 (Open)](/task/019-task-02)

- [019 Task 03 (Open)](/task/019-task-03)

- [019 Task 04 (Open)](/task/019-task-04)

- [019 Task 05 (Open)](/task/019-task-05)

- [019 Task 06 (Open)](/task/019-task-06)

- [019 Task 07 (Open)](/task/019-task-07)

- [019 Task 08 (Open)](/task/019-task-08)

- [019 Task 09 (Open)](/task/019-task-09)

- [019 Task 10 (Open)](/task/019-task-10)

- [019 Task 11 (Open)](/task/019-task-11)

- [019 Task 12 (Open)](/task/019-task-12)

- [019 Task 13 (Open)](/task/019-task-13)

- [019 Task 14 (Open)](/task/019-task-14)

- [019 Task 15 (Open)](/task/019-task-15)' \\
  --new '- [019 Task 01 (Open)](/task/019-task-01)

- [019 Task 07 (Open)](/task/019-task-07)

- [019 Task 08 (Open)](/task/019-task-08)

- [019 Task 09 (Open)](/task/019-task-09)

- [019 Task 10 (Open)](/task/019-task-10)

- [019 Task 11 (Open)](/task/019-task-11)

- [019 Task 12 (Open)](/task/019-task-12)

- [019 Task 13 (Open)](/task/019-task-13)

- [019 Task 14 (Open)](/task/019-task-14)

- [019 Task 15 (Open)](/task/019-task-15)

- [019 Task 02 (Open)](/task/019-task-02)

- [019 Task 03 (Open)](/task/019-task-03)

- [019 Task 04 (Open)](/task/019-task-04)

- [019 Task 05 (Open)](/task/019-task-05)

- [019 Task 06 (Open)](/task/019-task-06)'
alpine read /task/parent-019/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 019 (Open)](/task/parent-019).

- [019 Task 01 (Open)](/task/019-task-01)

- [019 Task 07 (Open)](/task/019-task-07)

- [019 Task 08 (Open)](/task/019-task-08)

- [019 Task 09 (Open)](/task/019-task-09)

- [019 Task 10 (Open)](/task/019-task-10)

- [019 Task 11 (Open)](/task/019-task-11)

- [019 Task 12 (Open)](/task/019-task-12)

- [019 Task 13 (Open)](/task/019-task-13)

- [019 Task 14 (Open)](/task/019-task-14)

- [019 Task 15 (Open)](/task/019-task-15)

- [019 Task 02 (Open)](/task/019-task-02)

- [019 Task 03 (Open)](/task/019-task-03)

- [019 Task 04 (Open)](/task/019-task-04)

- [019 Task 05 (Open)](/task/019-task-05)

- [019 Task 06 (Open)](/task/019-task-06)

- [019 After pagination guard with a deliberately long title (Open)](/task/019-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one newly created task to end; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 020

## Subtasks

- 020 Before (Open)
- 020 Task 01 (Open)
- 020 Task 02 (Open)
- 020 Task 03 (Open)
- 020 Task 04 (Open)
- 020 Task 05 (Open)
- 020 Task 06 (Open)
- 020 Task 07 (Open)
- 020 Task 08 (Open)
- 020 Task 09 (Open)
- 020 Task 10 (Open)
- 020 Task 11 (Open)
- 020 Task 12 (Open)
- 020 Task 13 (Open)
- 020 Task 14 (Open)
- 020 Task 15 (Open)
- 020 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 020](/task/parent-020).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-020/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [020 Task 01 (Open)](/task/020-task-01)

- [020 Task 02 (Open)](/task/020-task-02)

- [020 Task 03 (Open)](/task/020-task-03)

- [020 Task 04 (Open)](/task/020-task-04)

- [020 Task 05 (Open)](/task/020-task-05)

- [020 Task 06 (Open)](/task/020-task-06)

- [020 Task 07 (Open)](/task/020-task-07)

- [020 Task 08 (Open)](/task/020-task-08)

- [020 Task 09 (Open)](/task/020-task-09)

- [020 Task 10 (Open)](/task/020-task-10)

- [020 Task 11 (Open)](/task/020-task-11)

- [020 Task 12 (Open)](/task/020-task-12)

- [020 Task 13 (Open)](/task/020-task-13)

- [020 Task 14 (Open)](/task/020-task-14)

- [020 Task 15 (Open)](/task/020-task-15)' \\
  --new '- [020 Task 01 (Open)](/task/020-task-01)

- [020 Task 02 (Open)](/task/020-task-02)

- [020 Task 03 (Open)](/task/020-task-03)

- [020 Task 04 (Open)](/task/020-task-04)

- [020 Task 05 (Open)](/task/020-task-05)

- [020 Task 06 (Open)](/task/020-task-06)

- [020 Task 07 (Open)](/task/020-task-07)

- [020 Task 08 (Open)](/task/020-task-08)

- [020 Task 09 (Open)](/task/020-task-09)

- [020 Task 10 (Open)](/task/020-task-10)

- [020 Task 11 (Open)](/task/020-task-11)

- [020 Task 12 (Open)](/task/020-task-12)

- [020 Task 13 (Open)](/task/020-task-13)

- [020 Task 14 (Open)](/task/020-task-14)

- [020 Task 15 (Open)](/task/020-task-15)

- 020 Moved new 1 (Open)'
alpine read /task/parent-020/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 020 (Open)](/task/parent-020).

- [020 Before (Open)](/task/020-before)

- [020 Task 01 (Open)](/task/020-task-01)

- [020 Task 02 (Open)](/task/020-task-02)

- [020 Task 03 (Open)](/task/020-task-03)

- [020 Task 04 (Open)](/task/020-task-04)

- [020 Task 05 (Open)](/task/020-task-05)

- [020 Task 06 (Open)](/task/020-task-06)

- [020 Task 07 (Open)](/task/020-task-07)

- [020 Task 08 (Open)](/task/020-task-08)

- [020 Task 09 (Open)](/task/020-task-09)

- [020 Task 10 (Open)](/task/020-task-10)

- [020 Task 11 (Open)](/task/020-task-11)

- [020 Task 12 (Open)](/task/020-task-12)

- [020 Task 13 (Open)](/task/020-task-13)

- [020 Task 14 (Open)](/task/020-task-14)

- [020 Task 15 (Open)](/task/020-task-15)

- [020 Moved new 1 (Open)](/task/020-moved-new-1)

- [020 After pagination guard with a deliberately long title (Open)](/task/020-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two newly created tasks to end; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 021

## Subtasks

- 021 Before (Open)
- 021 Task 01 (Open)
- 021 Task 02 (Open)
- 021 Task 03 (Open)
- 021 Task 04 (Open)
- 021 Task 05 (Open)
- 021 Task 06 (Open)
- 021 Task 07 (Open)
- 021 Task 08 (Open)
- 021 Task 09 (Open)
- 021 Task 10 (Open)
- 021 Task 11 (Open)
- 021 Task 12 (Open)
- 021 Task 13 (Open)
- 021 Task 14 (Open)
- 021 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 021](/task/parent-021).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-021/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [021 Task 01 (Open)](/task/021-task-01)

- [021 Task 02 (Open)](/task/021-task-02)

- [021 Task 03 (Open)](/task/021-task-03)

- [021 Task 04 (Open)](/task/021-task-04)

- [021 Task 05 (Open)](/task/021-task-05)

- [021 Task 06 (Open)](/task/021-task-06)

- [021 Task 07 (Open)](/task/021-task-07)

- [021 Task 08 (Open)](/task/021-task-08)

- [021 Task 09 (Open)](/task/021-task-09)

- [021 Task 10 (Open)](/task/021-task-10)

- [021 Task 11 (Open)](/task/021-task-11)

- [021 Task 12 (Open)](/task/021-task-12)

- [021 Task 13 (Open)](/task/021-task-13)

- [021 Task 14 (Open)](/task/021-task-14)

- [021 Task 15 (Open)](/task/021-task-15)' \\
  --new '- [021 Task 01 (Open)](/task/021-task-01)

- [021 Task 02 (Open)](/task/021-task-02)

- [021 Task 03 (Open)](/task/021-task-03)

- [021 Task 04 (Open)](/task/021-task-04)

- [021 Task 05 (Open)](/task/021-task-05)

- [021 Task 06 (Open)](/task/021-task-06)

- [021 Task 07 (Open)](/task/021-task-07)

- [021 Task 08 (Open)](/task/021-task-08)

- [021 Task 09 (Open)](/task/021-task-09)

- [021 Task 10 (Open)](/task/021-task-10)

- [021 Task 11 (Open)](/task/021-task-11)

- [021 Task 12 (Open)](/task/021-task-12)

- [021 Task 13 (Open)](/task/021-task-13)

- [021 Task 14 (Open)](/task/021-task-14)

- [021 Task 15 (Open)](/task/021-task-15)

- 021 Moved new 1 (Open)

- 021 Moved new 2 (Open)'
alpine read /task/parent-021/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 021 (Open)](/task/parent-021).

- [021 Before (Open)](/task/021-before)

- [021 Task 01 (Open)](/task/021-task-01)

- [021 Task 02 (Open)](/task/021-task-02)

- [021 Task 03 (Open)](/task/021-task-03)

- [021 Task 04 (Open)](/task/021-task-04)

- [021 Task 05 (Open)](/task/021-task-05)

- [021 Task 06 (Open)](/task/021-task-06)

- [021 Task 07 (Open)](/task/021-task-07)

- [021 Task 08 (Open)](/task/021-task-08)

- [021 Task 09 (Open)](/task/021-task-09)

- [021 Task 10 (Open)](/task/021-task-10)

- [021 Task 11 (Open)](/task/021-task-11)

- [021 Task 12 (Open)](/task/021-task-12)

- [021 Task 13 (Open)](/task/021-task-13)

- [021 Task 14 (Open)](/task/021-task-14)

- [021 Task 15 (Open)](/task/021-task-15)

- [021 Moved new 1 (Open)](/task/021-moved-new-1)

- [021 Moved new 2 (Open)](/task/021-moved-new-2)

End of tasks.
`);
});

test("five newly created tasks to end; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 022

- 022 Task 01 (Open)
- 022 Task 02 (Open)
- 022 Task 03 (Open)
- 022 Task 04 (Open)
- 022 Task 05 (Open)
- 022 Task 06 (Open)
- 022 Task 07 (Open)
- 022 Task 08 (Open)
- 022 Task 09 (Open)
- 022 Task 10 (Open)
- 022 Task 11 (Open)
- 022 Task 12 (Open)
- 022 Task 13 (Open)
- 022 Task 14 (Open)
- 022 Task 15 (Open)
- 022 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 022](/task-collection/roadmap-022).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-022 --limit 850b >/dev/null
alpine update /task-collection/roadmap-022 \\
  --old '- [022 Task 01 (Open)](/task/022-task-01)

- [022 Task 02 (Open)](/task/022-task-02)

- [022 Task 03 (Open)](/task/022-task-03)

- [022 Task 04 (Open)](/task/022-task-04)

- [022 Task 05 (Open)](/task/022-task-05)

- [022 Task 06 (Open)](/task/022-task-06)

- [022 Task 07 (Open)](/task/022-task-07)

- [022 Task 08 (Open)](/task/022-task-08)

- [022 Task 09 (Open)](/task/022-task-09)

- [022 Task 10 (Open)](/task/022-task-10)

- [022 Task 11 (Open)](/task/022-task-11)

- [022 Task 12 (Open)](/task/022-task-12)

- [022 Task 13 (Open)](/task/022-task-13)

- [022 Task 14 (Open)](/task/022-task-14)

- [022 Task 15 (Open)](/task/022-task-15)' \\
  --new '- [022 Task 01 (Open)](/task/022-task-01)

- [022 Task 02 (Open)](/task/022-task-02)

- [022 Task 03 (Open)](/task/022-task-03)

- [022 Task 04 (Open)](/task/022-task-04)

- [022 Task 05 (Open)](/task/022-task-05)

- [022 Task 06 (Open)](/task/022-task-06)

- [022 Task 07 (Open)](/task/022-task-07)

- [022 Task 08 (Open)](/task/022-task-08)

- [022 Task 09 (Open)](/task/022-task-09)

- [022 Task 10 (Open)](/task/022-task-10)

- [022 Task 11 (Open)](/task/022-task-11)

- [022 Task 12 (Open)](/task/022-task-12)

- [022 Task 13 (Open)](/task/022-task-13)

- [022 Task 14 (Open)](/task/022-task-14)

- [022 Task 15 (Open)](/task/022-task-15)

- 022 Moved new 1 (Open)

- 022 Moved new 2 (Open)

- 022 Moved new 3 (Open)

- 022 Moved new 4 (Open)

- 022 Moved new 5 (Open)'
alpine read /task-collection/roadmap-022 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 022

- [022 Task 01 (Open)](/task/022-task-01)

- [022 Task 02 (Open)](/task/022-task-02)

- [022 Task 03 (Open)](/task/022-task-03)

- [022 Task 04 (Open)](/task/022-task-04)

- [022 Task 05 (Open)](/task/022-task-05)

- [022 Task 06 (Open)](/task/022-task-06)

- [022 Task 07 (Open)](/task/022-task-07)

- [022 Task 08 (Open)](/task/022-task-08)

- [022 Task 09 (Open)](/task/022-task-09)

- [022 Task 10 (Open)](/task/022-task-10)

- [022 Task 11 (Open)](/task/022-task-11)

- [022 Task 12 (Open)](/task/022-task-12)

- [022 Task 13 (Open)](/task/022-task-13)

- [022 Task 14 (Open)](/task/022-task-14)

- [022 Task 15 (Open)](/task/022-task-15)

- [022 Moved new 1 (Open)](/task/022-moved-new-1)

- [022 Moved new 2 (Open)](/task/022-moved-new-2)

- [022 Moved new 3 (Open)](/task/022-moved-new-3)

- [022 Moved new 4 (Open)](/task/022-moved-new-4)

- [022 Moved new 5 (Open)](/task/022-moved-new-5)

- [022 After pagination guard with a deliberately long title (Open)](/task/022-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one task created by the previous update to end; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 023

- 023 Before (Open)
- 023 Task 01 (Open)
- 023 Task 02 (Open)
- 023 Task 03 (Open)
- 023 Task 04 (Open)
- 023 Task 05 (Open)
- 023 Task 06 (Open)
- 023 Task 07 (Open)
- 023 Task 08 (Open)
- 023 Task 09 (Open)
- 023 Task 10 (Open)
- 023 Task 11 (Open)
- 023 Task 12 (Open)
- 023 Task 13 (Open)
- 023 Task 14 (Open)
- 023 Task 15 (Open)
- 023 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 023](/task-collection/roadmap-023).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-023 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [023 Task 01 (Open)](/task/023-task-01)

- [023 Task 02 (Open)](/task/023-task-02)

- [023 Task 03 (Open)](/task/023-task-03)

- [023 Task 04 (Open)](/task/023-task-04)

- [023 Task 05 (Open)](/task/023-task-05)

- [023 Task 06 (Open)](/task/023-task-06)

- [023 Task 07 (Open)](/task/023-task-07)

- [023 Task 08 (Open)](/task/023-task-08)

- [023 Task 09 (Open)](/task/023-task-09)

- [023 Task 10 (Open)](/task/023-task-10)

- [023 Task 11 (Open)](/task/023-task-11)

- [023 Task 12 (Open)](/task/023-task-12)

- [023 Task 13 (Open)](/task/023-task-13)

- [023 Task 14 (Open)](/task/023-task-14)

- [023 Task 15 (Open)](/task/023-task-15)' \\
  --new '- [023 Task 01 (Open)](/task/023-task-01)

- [023 Task 02 (Open)](/task/023-task-02)

- 023 Moved previous 1 (Open)

- [023 Task 03 (Open)](/task/023-task-03)

- [023 Task 04 (Open)](/task/023-task-04)

- [023 Task 05 (Open)](/task/023-task-05)

- [023 Task 06 (Open)](/task/023-task-06)

- [023 Task 07 (Open)](/task/023-task-07)

- [023 Task 08 (Open)](/task/023-task-08)

- [023 Task 09 (Open)](/task/023-task-09)

- [023 Task 10 (Open)](/task/023-task-10)

- [023 Task 11 (Open)](/task/023-task-11)

- [023 Task 12 (Open)](/task/023-task-12)

- [023 Task 13 (Open)](/task/023-task-13)

- [023 Task 14 (Open)](/task/023-task-14)

- [023 Task 15 (Open)](/task/023-task-15)'
alpine update $path \\
  --old '- [023 Task 01 (Open)](/task/023-task-01)

- [023 Task 02 (Open)](/task/023-task-02)

- 023 Moved previous 1 (Open)

- [023 Task 03 (Open)](/task/023-task-03)

- [023 Task 04 (Open)](/task/023-task-04)

- [023 Task 05 (Open)](/task/023-task-05)

- [023 Task 06 (Open)](/task/023-task-06)

- [023 Task 07 (Open)](/task/023-task-07)

- [023 Task 08 (Open)](/task/023-task-08)

- [023 Task 09 (Open)](/task/023-task-09)

- [023 Task 10 (Open)](/task/023-task-10)

- [023 Task 11 (Open)](/task/023-task-11)

- [023 Task 12 (Open)](/task/023-task-12)

- [023 Task 13 (Open)](/task/023-task-13)

- [023 Task 14 (Open)](/task/023-task-14)

- [023 Task 15 (Open)](/task/023-task-15)' \\
  --new '- [023 Task 01 (Open)](/task/023-task-01)

- [023 Task 02 (Open)](/task/023-task-02)

- [023 Task 03 (Open)](/task/023-task-03)

- [023 Task 04 (Open)](/task/023-task-04)

- [023 Task 05 (Open)](/task/023-task-05)

- [023 Task 06 (Open)](/task/023-task-06)

- [023 Task 07 (Open)](/task/023-task-07)

- [023 Task 08 (Open)](/task/023-task-08)

- [023 Task 09 (Open)](/task/023-task-09)

- [023 Task 10 (Open)](/task/023-task-10)

- [023 Task 11 (Open)](/task/023-task-11)

- [023 Task 12 (Open)](/task/023-task-12)

- [023 Task 13 (Open)](/task/023-task-13)

- [023 Task 14 (Open)](/task/023-task-14)

- [023 Task 15 (Open)](/task/023-task-15)

- 023 Moved previous 1 (Open)'
alpine read /task-collection/roadmap-023 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 023

- [023 Before (Open)](/task/023-before)

- [023 Task 01 (Open)](/task/023-task-01)

- [023 Task 02 (Open)](/task/023-task-02)

- [023 Task 03 (Open)](/task/023-task-03)

- [023 Task 04 (Open)](/task/023-task-04)

- [023 Task 05 (Open)](/task/023-task-05)

- [023 Task 06 (Open)](/task/023-task-06)

- [023 Task 07 (Open)](/task/023-task-07)

- [023 Task 08 (Open)](/task/023-task-08)

- [023 Task 09 (Open)](/task/023-task-09)

- [023 Task 10 (Open)](/task/023-task-10)

- [023 Task 11 (Open)](/task/023-task-11)

- [023 Task 12 (Open)](/task/023-task-12)

- [023 Task 13 (Open)](/task/023-task-13)

- [023 Task 14 (Open)](/task/023-task-14)

- [023 Task 15 (Open)](/task/023-task-15)

- [023 Moved previous 1 (Open)](/task/023-moved-previous-1)

- [023 After pagination guard with a deliberately long title (Open)](/task/023-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two tasks created by the previous update to end; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 024

- 024 Before (Open)
- 024 Task 01 (Open)
- 024 Task 02 (Open)
- 024 Task 03 (Open)
- 024 Task 04 (Open)
- 024 Task 05 (Open)
- 024 Task 06 (Open)
- 024 Task 07 (Open)
- 024 Task 08 (Open)
- 024 Task 09 (Open)
- 024 Task 10 (Open)
- 024 Task 11 (Open)
- 024 Task 12 (Open)
- 024 Task 13 (Open)
- 024 Task 14 (Open)
- 024 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 024](/task-collection/roadmap-024).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-024 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [024 Task 01 (Open)](/task/024-task-01)

- [024 Task 02 (Open)](/task/024-task-02)

- [024 Task 03 (Open)](/task/024-task-03)

- [024 Task 04 (Open)](/task/024-task-04)

- [024 Task 05 (Open)](/task/024-task-05)

- [024 Task 06 (Open)](/task/024-task-06)

- [024 Task 07 (Open)](/task/024-task-07)

- [024 Task 08 (Open)](/task/024-task-08)

- [024 Task 09 (Open)](/task/024-task-09)

- [024 Task 10 (Open)](/task/024-task-10)

- [024 Task 11 (Open)](/task/024-task-11)

- [024 Task 12 (Open)](/task/024-task-12)

- [024 Task 13 (Open)](/task/024-task-13)

- [024 Task 14 (Open)](/task/024-task-14)

- [024 Task 15 (Open)](/task/024-task-15)' \\
  --new '- [024 Task 01 (Open)](/task/024-task-01)

- [024 Task 02 (Open)](/task/024-task-02)

- 024 Moved previous 1 (Open)

- 024 Moved previous 2 (Open)

- [024 Task 03 (Open)](/task/024-task-03)

- [024 Task 04 (Open)](/task/024-task-04)

- [024 Task 05 (Open)](/task/024-task-05)

- [024 Task 06 (Open)](/task/024-task-06)

- [024 Task 07 (Open)](/task/024-task-07)

- [024 Task 08 (Open)](/task/024-task-08)

- [024 Task 09 (Open)](/task/024-task-09)

- [024 Task 10 (Open)](/task/024-task-10)

- [024 Task 11 (Open)](/task/024-task-11)

- [024 Task 12 (Open)](/task/024-task-12)

- [024 Task 13 (Open)](/task/024-task-13)

- [024 Task 14 (Open)](/task/024-task-14)

- [024 Task 15 (Open)](/task/024-task-15)'
alpine update $path \\
  --old '- [024 Task 01 (Open)](/task/024-task-01)

- [024 Task 02 (Open)](/task/024-task-02)

- 024 Moved previous 1 (Open)

- 024 Moved previous 2 (Open)

- [024 Task 03 (Open)](/task/024-task-03)

- [024 Task 04 (Open)](/task/024-task-04)

- [024 Task 05 (Open)](/task/024-task-05)

- [024 Task 06 (Open)](/task/024-task-06)

- [024 Task 07 (Open)](/task/024-task-07)

- [024 Task 08 (Open)](/task/024-task-08)

- [024 Task 09 (Open)](/task/024-task-09)

- [024 Task 10 (Open)](/task/024-task-10)

- [024 Task 11 (Open)](/task/024-task-11)

- [024 Task 12 (Open)](/task/024-task-12)

- [024 Task 13 (Open)](/task/024-task-13)

- [024 Task 14 (Open)](/task/024-task-14)

- [024 Task 15 (Open)](/task/024-task-15)' \\
  --new '- [024 Task 01 (Open)](/task/024-task-01)

- [024 Task 02 (Open)](/task/024-task-02)

- [024 Task 03 (Open)](/task/024-task-03)

- [024 Task 04 (Open)](/task/024-task-04)

- [024 Task 05 (Open)](/task/024-task-05)

- [024 Task 06 (Open)](/task/024-task-06)

- [024 Task 07 (Open)](/task/024-task-07)

- [024 Task 08 (Open)](/task/024-task-08)

- [024 Task 09 (Open)](/task/024-task-09)

- [024 Task 10 (Open)](/task/024-task-10)

- [024 Task 11 (Open)](/task/024-task-11)

- [024 Task 12 (Open)](/task/024-task-12)

- [024 Task 13 (Open)](/task/024-task-13)

- [024 Task 14 (Open)](/task/024-task-14)

- [024 Task 15 (Open)](/task/024-task-15)

- 024 Moved previous 1 (Open)

- 024 Moved previous 2 (Open)'
alpine read /task-collection/roadmap-024 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 024

- [024 Before (Open)](/task/024-before)

- [024 Task 01 (Open)](/task/024-task-01)

- [024 Task 02 (Open)](/task/024-task-02)

- [024 Task 03 (Open)](/task/024-task-03)

- [024 Task 04 (Open)](/task/024-task-04)

- [024 Task 05 (Open)](/task/024-task-05)

- [024 Task 06 (Open)](/task/024-task-06)

- [024 Task 07 (Open)](/task/024-task-07)

- [024 Task 08 (Open)](/task/024-task-08)

- [024 Task 09 (Open)](/task/024-task-09)

- [024 Task 10 (Open)](/task/024-task-10)

- [024 Task 11 (Open)](/task/024-task-11)

- [024 Task 12 (Open)](/task/024-task-12)

- [024 Task 13 (Open)](/task/024-task-13)

- [024 Task 14 (Open)](/task/024-task-14)

- [024 Task 15 (Open)](/task/024-task-15)

- [024 Moved previous 1 (Open)](/task/024-moved-previous-1)

- [024 Moved previous 2 (Open)](/task/024-moved-previous-2)

End of tasks.
`);
});

test("five tasks created by the previous update to end; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 025

## Subtasks

- 025 Task 01 (Open)
- 025 Task 02 (Open)
- 025 Task 03 (Open)
- 025 Task 04 (Open)
- 025 Task 05 (Open)
- 025 Task 06 (Open)
- 025 Task 07 (Open)
- 025 Task 08 (Open)
- 025 Task 09 (Open)
- 025 Task 10 (Open)
- 025 Task 11 (Open)
- 025 Task 12 (Open)
- 025 Task 13 (Open)
- 025 Task 14 (Open)
- 025 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 025](/task/parent-025).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-025 --limit 100kb >/dev/null
alpine update /task/parent-025 \\
  --old '- [025 Task 01 (Open)](/task/025-task-01)

- [025 Task 02 (Open)](/task/025-task-02)

- [025 Task 03 (Open)](/task/025-task-03)

- [025 Task 04 (Open)](/task/025-task-04)

- [025 Task 05 (Open)](/task/025-task-05)

- [025 Task 06 (Open)](/task/025-task-06)

- [025 Task 07 (Open)](/task/025-task-07)

- [025 Task 08 (Open)](/task/025-task-08)

- [025 Task 09 (Open)](/task/025-task-09)

- [025 Task 10 (Open)](/task/025-task-10)

- [025 Task 11 (Open)](/task/025-task-11)

- [025 Task 12 (Open)](/task/025-task-12)

- [025 Task 13 (Open)](/task/025-task-13)

- [025 Task 14 (Open)](/task/025-task-14)

- [025 Task 15 (Open)](/task/025-task-15)' \\
  --new '- [025 Task 01 (Open)](/task/025-task-01)

- [025 Task 02 (Open)](/task/025-task-02)

- 025 Moved previous 1 (Open)

- 025 Moved previous 2 (Open)

- 025 Moved previous 3 (Open)

- 025 Moved previous 4 (Open)

- 025 Moved previous 5 (Open)

- [025 Task 03 (Open)](/task/025-task-03)

- [025 Task 04 (Open)](/task/025-task-04)

- [025 Task 05 (Open)](/task/025-task-05)

- [025 Task 06 (Open)](/task/025-task-06)

- [025 Task 07 (Open)](/task/025-task-07)

- [025 Task 08 (Open)](/task/025-task-08)

- [025 Task 09 (Open)](/task/025-task-09)

- [025 Task 10 (Open)](/task/025-task-10)

- [025 Task 11 (Open)](/task/025-task-11)

- [025 Task 12 (Open)](/task/025-task-12)

- [025 Task 13 (Open)](/task/025-task-13)

- [025 Task 14 (Open)](/task/025-task-14)

- [025 Task 15 (Open)](/task/025-task-15)'
alpine update /task/parent-025 \\
  --old '- [025 Task 01 (Open)](/task/025-task-01)

- [025 Task 02 (Open)](/task/025-task-02)

- 025 Moved previous 1 (Open)

- 025 Moved previous 2 (Open)

- 025 Moved previous 3 (Open)

- 025 Moved previous 4 (Open)

- 025 Moved previous 5 (Open)

- [025 Task 03 (Open)](/task/025-task-03)

- [025 Task 04 (Open)](/task/025-task-04)

- [025 Task 05 (Open)](/task/025-task-05)

- [025 Task 06 (Open)](/task/025-task-06)

- [025 Task 07 (Open)](/task/025-task-07)

- [025 Task 08 (Open)](/task/025-task-08)

- [025 Task 09 (Open)](/task/025-task-09)

- [025 Task 10 (Open)](/task/025-task-10)

- [025 Task 11 (Open)](/task/025-task-11)

- [025 Task 12 (Open)](/task/025-task-12)

- [025 Task 13 (Open)](/task/025-task-13)

- [025 Task 14 (Open)](/task/025-task-14)

- [025 Task 15 (Open)](/task/025-task-15)' \\
  --new '- [025 Task 01 (Open)](/task/025-task-01)

- [025 Task 02 (Open)](/task/025-task-02)

- [025 Task 03 (Open)](/task/025-task-03)

- [025 Task 04 (Open)](/task/025-task-04)

- [025 Task 05 (Open)](/task/025-task-05)

- [025 Task 06 (Open)](/task/025-task-06)

- [025 Task 07 (Open)](/task/025-task-07)

- [025 Task 08 (Open)](/task/025-task-08)

- [025 Task 09 (Open)](/task/025-task-09)

- [025 Task 10 (Open)](/task/025-task-10)

- [025 Task 11 (Open)](/task/025-task-11)

- [025 Task 12 (Open)](/task/025-task-12)

- [025 Task 13 (Open)](/task/025-task-13)

- [025 Task 14 (Open)](/task/025-task-14)

- [025 Task 15 (Open)](/task/025-task-15)

- 025 Moved previous 1 (Open)

- 025 Moved previous 2 (Open)

- 025 Moved previous 3 (Open)

- 025 Moved previous 4 (Open)

- 025 Moved previous 5 (Open)'
alpine read /task/parent-025 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 025

- Status: Open

## Subtasks

- [025 Task 01 (Open)](/task/025-task-01)

- [025 Task 02 (Open)](/task/025-task-02)

- [025 Task 03 (Open)](/task/025-task-03)

- [025 Task 04 (Open)](/task/025-task-04)

- [025 Task 05 (Open)](/task/025-task-05)

- [025 Task 06 (Open)](/task/025-task-06)

- [025 Task 07 (Open)](/task/025-task-07)

- [025 Task 08 (Open)](/task/025-task-08)

- [025 Task 09 (Open)](/task/025-task-09)

- [025 Task 10 (Open)](/task/025-task-10)

- [025 Task 11 (Open)](/task/025-task-11)

- [025 Task 12 (Open)](/task/025-task-12)

- [025 Task 13 (Open)](/task/025-task-13)

- [025 Task 14 (Open)](/task/025-task-14)

- [025 Task 15 (Open)](/task/025-task-15)

- [025 Moved previous 1 (Open)](/task/025-moved-previous-1)

- [025 Moved previous 2 (Open)](/task/025-moved-previous-2)

- [025 Moved previous 3 (Open)](/task/025-moved-previous-3)

- [025 Moved previous 4 (Open)](/task/025-moved-previous-4)

- [025 Moved previous 5 (Open)](/task/025-moved-previous-5)
`);
});

test("one existing then one newly created task to end; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 026

## Subtasks

- 026 Task 01 (Open)
- 026 Task 02 (Open)
- 026 Task 03 (Open)
- 026 Task 04 (Open)
- 026 Task 05 (Open)
- 026 Task 06 (Open)
- 026 Task 07 (Open)
- 026 Task 08 (Open)
- 026 Task 09 (Open)
- 026 Task 10 (Open)
- 026 Task 11 (Open)
- 026 Task 12 (Open)
- 026 Task 13 (Open)
- 026 Task 14 (Open)
- 026 Task 15 (Open)
- 026 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 026](/task/parent-026).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-026/subtasks --limit 850b >/dev/null
alpine update /task/parent-026/subtasks \\
  --old '- [026 Task 01 (Open)](/task/026-task-01)

- [026 Task 02 (Open)](/task/026-task-02)

- [026 Task 03 (Open)](/task/026-task-03)

- [026 Task 04 (Open)](/task/026-task-04)

- [026 Task 05 (Open)](/task/026-task-05)

- [026 Task 06 (Open)](/task/026-task-06)

- [026 Task 07 (Open)](/task/026-task-07)

- [026 Task 08 (Open)](/task/026-task-08)

- [026 Task 09 (Open)](/task/026-task-09)

- [026 Task 10 (Open)](/task/026-task-10)

- [026 Task 11 (Open)](/task/026-task-11)

- [026 Task 12 (Open)](/task/026-task-12)

- [026 Task 13 (Open)](/task/026-task-13)

- [026 Task 14 (Open)](/task/026-task-14)

- [026 Task 15 (Open)](/task/026-task-15)' \\
  --new '- [026 Task 01 (Open)](/task/026-task-01)

- [026 Task 03 (Open)](/task/026-task-03)

- [026 Task 04 (Open)](/task/026-task-04)

- [026 Task 05 (Open)](/task/026-task-05)

- [026 Task 06 (Open)](/task/026-task-06)

- [026 Task 07 (Open)](/task/026-task-07)

- [026 Task 08 (Open)](/task/026-task-08)

- [026 Task 09 (Open)](/task/026-task-09)

- [026 Task 10 (Open)](/task/026-task-10)

- [026 Task 11 (Open)](/task/026-task-11)

- [026 Task 12 (Open)](/task/026-task-12)

- [026 Task 13 (Open)](/task/026-task-13)

- [026 Task 14 (Open)](/task/026-task-14)

- [026 Task 15 (Open)](/task/026-task-15)

- [026 Task 02 (Open)](/task/026-task-02)

- 026 Moved new 1 (Open)'
alpine read /task/parent-026/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 026 (Open)](/task/parent-026).

- [026 Task 01 (Open)](/task/026-task-01)

- [026 Task 03 (Open)](/task/026-task-03)

- [026 Task 04 (Open)](/task/026-task-04)

- [026 Task 05 (Open)](/task/026-task-05)

- [026 Task 06 (Open)](/task/026-task-06)

- [026 Task 07 (Open)](/task/026-task-07)

- [026 Task 08 (Open)](/task/026-task-08)

- [026 Task 09 (Open)](/task/026-task-09)

- [026 Task 10 (Open)](/task/026-task-10)

- [026 Task 11 (Open)](/task/026-task-11)

- [026 Task 12 (Open)](/task/026-task-12)

- [026 Task 13 (Open)](/task/026-task-13)

- [026 Task 14 (Open)](/task/026-task-14)

- [026 Task 15 (Open)](/task/026-task-15)

- [026 Task 02 (Open)](/task/026-task-02)

- [026 Moved new 1 (Open)](/task/026-moved-new-1)

- [026 After pagination guard with a deliberately long title (Open)](/task/026-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one newly created then one existing task to end; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 027

## Subtasks

- 027 Before (Open)
- 027 Task 01 (Open)
- 027 Task 02 (Open)
- 027 Task 03 (Open)
- 027 Task 04 (Open)
- 027 Task 05 (Open)
- 027 Task 06 (Open)
- 027 Task 07 (Open)
- 027 Task 08 (Open)
- 027 Task 09 (Open)
- 027 Task 10 (Open)
- 027 Task 11 (Open)
- 027 Task 12 (Open)
- 027 Task 13 (Open)
- 027 Task 14 (Open)
- 027 Task 15 (Open)
- 027 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 027](/task/parent-027).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-027/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [027 Task 01 (Open)](/task/027-task-01)

- [027 Task 02 (Open)](/task/027-task-02)

- [027 Task 03 (Open)](/task/027-task-03)

- [027 Task 04 (Open)](/task/027-task-04)

- [027 Task 05 (Open)](/task/027-task-05)

- [027 Task 06 (Open)](/task/027-task-06)

- [027 Task 07 (Open)](/task/027-task-07)

- [027 Task 08 (Open)](/task/027-task-08)

- [027 Task 09 (Open)](/task/027-task-09)

- [027 Task 10 (Open)](/task/027-task-10)

- [027 Task 11 (Open)](/task/027-task-11)

- [027 Task 12 (Open)](/task/027-task-12)

- [027 Task 13 (Open)](/task/027-task-13)

- [027 Task 14 (Open)](/task/027-task-14)

- [027 Task 15 (Open)](/task/027-task-15)' \\
  --new '- [027 Task 01 (Open)](/task/027-task-01)

- [027 Task 03 (Open)](/task/027-task-03)

- [027 Task 04 (Open)](/task/027-task-04)

- [027 Task 05 (Open)](/task/027-task-05)

- [027 Task 06 (Open)](/task/027-task-06)

- [027 Task 07 (Open)](/task/027-task-07)

- [027 Task 08 (Open)](/task/027-task-08)

- [027 Task 09 (Open)](/task/027-task-09)

- [027 Task 10 (Open)](/task/027-task-10)

- [027 Task 11 (Open)](/task/027-task-11)

- [027 Task 12 (Open)](/task/027-task-12)

- [027 Task 13 (Open)](/task/027-task-13)

- [027 Task 14 (Open)](/task/027-task-14)

- [027 Task 15 (Open)](/task/027-task-15)

- 027 Moved new 1 (Open)

- [027 Task 02 (Open)](/task/027-task-02)'
alpine read /task/parent-027/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 027 (Open)](/task/parent-027).

- [027 Before (Open)](/task/027-before)

- [027 Task 01 (Open)](/task/027-task-01)

- [027 Task 03 (Open)](/task/027-task-03)

- [027 Task 04 (Open)](/task/027-task-04)

- [027 Task 05 (Open)](/task/027-task-05)

- [027 Task 06 (Open)](/task/027-task-06)

- [027 Task 07 (Open)](/task/027-task-07)

- [027 Task 08 (Open)](/task/027-task-08)

- [027 Task 09 (Open)](/task/027-task-09)

- [027 Task 10 (Open)](/task/027-task-10)

- [027 Task 11 (Open)](/task/027-task-11)

- [027 Task 12 (Open)](/task/027-task-12)

- [027 Task 13 (Open)](/task/027-task-13)

- [027 Task 14 (Open)](/task/027-task-14)

- [027 Task 15 (Open)](/task/027-task-15)

- [027 Moved new 1 (Open)](/task/027-moved-new-1)

- [027 Task 02 (Open)](/task/027-task-02)

- [027 After pagination guard with a deliberately long title (Open)](/task/027-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing then three newly created tasks to end; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 028

## Subtasks

- 028 Before (Open)
- 028 Task 01 (Open)
- 028 Task 02 (Open)
- 028 Task 03 (Open)
- 028 Task 04 (Open)
- 028 Task 05 (Open)
- 028 Task 06 (Open)
- 028 Task 07 (Open)
- 028 Task 08 (Open)
- 028 Task 09 (Open)
- 028 Task 10 (Open)
- 028 Task 11 (Open)
- 028 Task 12 (Open)
- 028 Task 13 (Open)
- 028 Task 14 (Open)
- 028 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 028](/task/parent-028).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-028/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [028 Task 01 (Open)](/task/028-task-01)

- [028 Task 02 (Open)](/task/028-task-02)

- [028 Task 03 (Open)](/task/028-task-03)

- [028 Task 04 (Open)](/task/028-task-04)

- [028 Task 05 (Open)](/task/028-task-05)

- [028 Task 06 (Open)](/task/028-task-06)

- [028 Task 07 (Open)](/task/028-task-07)

- [028 Task 08 (Open)](/task/028-task-08)

- [028 Task 09 (Open)](/task/028-task-09)

- [028 Task 10 (Open)](/task/028-task-10)

- [028 Task 11 (Open)](/task/028-task-11)

- [028 Task 12 (Open)](/task/028-task-12)

- [028 Task 13 (Open)](/task/028-task-13)

- [028 Task 14 (Open)](/task/028-task-14)

- [028 Task 15 (Open)](/task/028-task-15)' \\
  --new '- [028 Task 01 (Open)](/task/028-task-01)

- [028 Task 04 (Open)](/task/028-task-04)

- [028 Task 05 (Open)](/task/028-task-05)

- [028 Task 06 (Open)](/task/028-task-06)

- [028 Task 07 (Open)](/task/028-task-07)

- [028 Task 08 (Open)](/task/028-task-08)

- [028 Task 09 (Open)](/task/028-task-09)

- [028 Task 10 (Open)](/task/028-task-10)

- [028 Task 11 (Open)](/task/028-task-11)

- [028 Task 12 (Open)](/task/028-task-12)

- [028 Task 13 (Open)](/task/028-task-13)

- [028 Task 14 (Open)](/task/028-task-14)

- [028 Task 15 (Open)](/task/028-task-15)

- [028 Task 02 (Open)](/task/028-task-02)

- [028 Task 03 (Open)](/task/028-task-03)

- 028 Moved new 1 (Open)

- 028 Moved new 2 (Open)

- 028 Moved new 3 (Open)'
alpine read /task/parent-028/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 028 (Open)](/task/parent-028).

- [028 Before (Open)](/task/028-before)

- [028 Task 01 (Open)](/task/028-task-01)

- [028 Task 04 (Open)](/task/028-task-04)

- [028 Task 05 (Open)](/task/028-task-05)

- [028 Task 06 (Open)](/task/028-task-06)

- [028 Task 07 (Open)](/task/028-task-07)

- [028 Task 08 (Open)](/task/028-task-08)

- [028 Task 09 (Open)](/task/028-task-09)

- [028 Task 10 (Open)](/task/028-task-10)

- [028 Task 11 (Open)](/task/028-task-11)

- [028 Task 12 (Open)](/task/028-task-12)

- [028 Task 13 (Open)](/task/028-task-13)

- [028 Task 14 (Open)](/task/028-task-14)

- [028 Task 15 (Open)](/task/028-task-15)

- [028 Task 02 (Open)](/task/028-task-02)

- [028 Task 03 (Open)](/task/028-task-03)

- [028 Moved new 1 (Open)](/task/028-moved-new-1)

- [028 Moved new 2 (Open)](/task/028-moved-new-2)

- [028 Moved new 3 (Open)](/task/028-moved-new-3)

End of tasks.
`);
});

test("two existing and three newly created tasks interleaved to end; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 029

- 029 Task 01 (Open)
- 029 Task 02 (Open)
- 029 Task 03 (Open)
- 029 Task 04 (Open)
- 029 Task 05 (Open)
- 029 Task 06 (Open)
- 029 Task 07 (Open)
- 029 Task 08 (Open)
- 029 Task 09 (Open)
- 029 Task 10 (Open)
- 029 Task 11 (Open)
- 029 Task 12 (Open)
- 029 Task 13 (Open)
- 029 Task 14 (Open)
- 029 Task 15 (Open)
- 029 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 029](/task-collection/roadmap-029).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-029 --limit 850b >/dev/null
alpine update /task-collection/roadmap-029 \\
  --old '- [029 Task 01 (Open)](/task/029-task-01)

- [029 Task 02 (Open)](/task/029-task-02)

- [029 Task 03 (Open)](/task/029-task-03)

- [029 Task 04 (Open)](/task/029-task-04)

- [029 Task 05 (Open)](/task/029-task-05)

- [029 Task 06 (Open)](/task/029-task-06)

- [029 Task 07 (Open)](/task/029-task-07)

- [029 Task 08 (Open)](/task/029-task-08)

- [029 Task 09 (Open)](/task/029-task-09)

- [029 Task 10 (Open)](/task/029-task-10)

- [029 Task 11 (Open)](/task/029-task-11)

- [029 Task 12 (Open)](/task/029-task-12)

- [029 Task 13 (Open)](/task/029-task-13)

- [029 Task 14 (Open)](/task/029-task-14)

- [029 Task 15 (Open)](/task/029-task-15)' \\
  --new '- [029 Task 01 (Open)](/task/029-task-01)

- [029 Task 04 (Open)](/task/029-task-04)

- [029 Task 05 (Open)](/task/029-task-05)

- [029 Task 06 (Open)](/task/029-task-06)

- [029 Task 07 (Open)](/task/029-task-07)

- [029 Task 08 (Open)](/task/029-task-08)

- [029 Task 09 (Open)](/task/029-task-09)

- [029 Task 10 (Open)](/task/029-task-10)

- [029 Task 11 (Open)](/task/029-task-11)

- [029 Task 12 (Open)](/task/029-task-12)

- [029 Task 13 (Open)](/task/029-task-13)

- [029 Task 14 (Open)](/task/029-task-14)

- [029 Task 15 (Open)](/task/029-task-15)

- [029 Task 02 (Open)](/task/029-task-02)

- 029 Moved new 1 (Open)

- [029 Task 03 (Open)](/task/029-task-03)

- 029 Moved new 2 (Open)

- 029 Moved new 3 (Open)'
alpine read /task-collection/roadmap-029 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 029

- [029 Task 01 (Open)](/task/029-task-01)

- [029 Task 04 (Open)](/task/029-task-04)

- [029 Task 05 (Open)](/task/029-task-05)

- [029 Task 06 (Open)](/task/029-task-06)

- [029 Task 07 (Open)](/task/029-task-07)

- [029 Task 08 (Open)](/task/029-task-08)

- [029 Task 09 (Open)](/task/029-task-09)

- [029 Task 10 (Open)](/task/029-task-10)

- [029 Task 11 (Open)](/task/029-task-11)

- [029 Task 12 (Open)](/task/029-task-12)

- [029 Task 13 (Open)](/task/029-task-13)

- [029 Task 14 (Open)](/task/029-task-14)

- [029 Task 15 (Open)](/task/029-task-15)

- [029 Task 02 (Open)](/task/029-task-02)

- [029 Moved new 1 (Open)](/task/029-moved-new-1)

- [029 Task 03 (Open)](/task/029-task-03)

- [029 Moved new 2 (Open)](/task/029-moved-new-2)

- [029 Moved new 3 (Open)](/task/029-moved-new-3)

- [029 After pagination guard with a deliberately long title (Open)](/task/029-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("three newly created then two existing tasks to end; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 030

- 030 Before (Open)
- 030 Task 01 (Open)
- 030 Task 02 (Open)
- 030 Task 03 (Open)
- 030 Task 04 (Open)
- 030 Task 05 (Open)
- 030 Task 06 (Open)
- 030 Task 07 (Open)
- 030 Task 08 (Open)
- 030 Task 09 (Open)
- 030 Task 10 (Open)
- 030 Task 11 (Open)
- 030 Task 12 (Open)
- 030 Task 13 (Open)
- 030 Task 14 (Open)
- 030 Task 15 (Open)
- 030 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 030](/task-collection/roadmap-030).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-030 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [030 Task 01 (Open)](/task/030-task-01)

- [030 Task 02 (Open)](/task/030-task-02)

- [030 Task 03 (Open)](/task/030-task-03)

- [030 Task 04 (Open)](/task/030-task-04)

- [030 Task 05 (Open)](/task/030-task-05)

- [030 Task 06 (Open)](/task/030-task-06)

- [030 Task 07 (Open)](/task/030-task-07)

- [030 Task 08 (Open)](/task/030-task-08)

- [030 Task 09 (Open)](/task/030-task-09)

- [030 Task 10 (Open)](/task/030-task-10)

- [030 Task 11 (Open)](/task/030-task-11)

- [030 Task 12 (Open)](/task/030-task-12)

- [030 Task 13 (Open)](/task/030-task-13)

- [030 Task 14 (Open)](/task/030-task-14)

- [030 Task 15 (Open)](/task/030-task-15)' \\
  --new '- [030 Task 01 (Open)](/task/030-task-01)

- [030 Task 04 (Open)](/task/030-task-04)

- [030 Task 05 (Open)](/task/030-task-05)

- [030 Task 06 (Open)](/task/030-task-06)

- [030 Task 07 (Open)](/task/030-task-07)

- [030 Task 08 (Open)](/task/030-task-08)

- [030 Task 09 (Open)](/task/030-task-09)

- [030 Task 10 (Open)](/task/030-task-10)

- [030 Task 11 (Open)](/task/030-task-11)

- [030 Task 12 (Open)](/task/030-task-12)

- [030 Task 13 (Open)](/task/030-task-13)

- [030 Task 14 (Open)](/task/030-task-14)

- [030 Task 15 (Open)](/task/030-task-15)

- 030 Moved new 1 (Open)

- 030 Moved new 2 (Open)

- 030 Moved new 3 (Open)

- [030 Task 02 (Open)](/task/030-task-02)

- [030 Task 03 (Open)](/task/030-task-03)'
alpine read /task-collection/roadmap-030 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 030

- [030 Before (Open)](/task/030-before)

- [030 Task 01 (Open)](/task/030-task-01)

- [030 Task 04 (Open)](/task/030-task-04)

- [030 Task 05 (Open)](/task/030-task-05)

- [030 Task 06 (Open)](/task/030-task-06)

- [030 Task 07 (Open)](/task/030-task-07)

- [030 Task 08 (Open)](/task/030-task-08)

- [030 Task 09 (Open)](/task/030-task-09)

- [030 Task 10 (Open)](/task/030-task-10)

- [030 Task 11 (Open)](/task/030-task-11)

- [030 Task 12 (Open)](/task/030-task-12)

- [030 Task 13 (Open)](/task/030-task-13)

- [030 Task 14 (Open)](/task/030-task-14)

- [030 Task 15 (Open)](/task/030-task-15)

- [030 Moved new 1 (Open)](/task/030-moved-new-1)

- [030 Moved new 2 (Open)](/task/030-moved-new-2)

- [030 Moved new 3 (Open)](/task/030-moved-new-3)

- [030 Task 02 (Open)](/task/030-task-02)

- [030 Task 03 (Open)](/task/030-task-03)

- [030 After pagination guard with a deliberately long title (Open)](/task/030-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 031

- 031 Before (Open)
- 031 Task 01 (Open)
- 031 Task 02 (Open)
- 031 Task 03 (Open)
- 031 Task 04 (Open)
- 031 Task 05 (Open)
- 031 Task 06 (Open)
- 031 Task 07 (Open)
- 031 Task 08 (Open)
- 031 Task 09 (Open)
- 031 Task 10 (Open)
- 031 Task 11 (Open)
- 031 Task 12 (Open)
- 031 Task 13 (Open)
- 031 Task 14 (Open)
- 031 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 031](/task-collection/roadmap-031).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-031 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [031 Task 01 (Open)](/task/031-task-01)

- [031 Task 02 (Open)](/task/031-task-02)

- [031 Task 03 (Open)](/task/031-task-03)

- [031 Task 04 (Open)](/task/031-task-04)

- [031 Task 05 (Open)](/task/031-task-05)

- [031 Task 06 (Open)](/task/031-task-06)

- [031 Task 07 (Open)](/task/031-task-07)

- [031 Task 08 (Open)](/task/031-task-08)

- [031 Task 09 (Open)](/task/031-task-09)

- [031 Task 10 (Open)](/task/031-task-10)

- [031 Task 11 (Open)](/task/031-task-11)

- [031 Task 12 (Open)](/task/031-task-12)

- [031 Task 13 (Open)](/task/031-task-13)

- [031 Task 14 (Open)](/task/031-task-14)

- [031 Task 15 (Open)](/task/031-task-15)' \\
  --new '- [031 Task 01 (Open)](/task/031-task-01)

- [031 Task 03 (Open)](/task/031-task-03)

- [031 Task 04 (Open)](/task/031-task-04)

- [031 Task 05 (Open)](/task/031-task-05)

- [031 Task 06 (Open)](/task/031-task-06)

- [031 Task 07 (Open)](/task/031-task-07)

- [031 Task 08 (Open)](/task/031-task-08)

- [031 Task 09 (Open)](/task/031-task-09)

- [031 Task 10 (Open)](/task/031-task-10)

- [031 Task 11 (Open)](/task/031-task-11)

- [031 Task 12 (Open)](/task/031-task-12)

- [031 Task 02 (Open)](/task/031-task-02)

- [031 Task 13 (Open)](/task/031-task-13)

- [031 Task 14 (Open)](/task/031-task-14)

- [031 Task 15 (Open)](/task/031-task-15)'
alpine read /task-collection/roadmap-031 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 031

- [031 Before (Open)](/task/031-before)

- [031 Task 01 (Open)](/task/031-task-01)

- [031 Task 03 (Open)](/task/031-task-03)

- [031 Task 04 (Open)](/task/031-task-04)

- [031 Task 05 (Open)](/task/031-task-05)

- [031 Task 06 (Open)](/task/031-task-06)

- [031 Task 07 (Open)](/task/031-task-07)

- [031 Task 08 (Open)](/task/031-task-08)

- [031 Task 09 (Open)](/task/031-task-09)

- [031 Task 10 (Open)](/task/031-task-10)

- [031 Task 11 (Open)](/task/031-task-11)

- [031 Task 12 (Open)](/task/031-task-12)

- [031 Task 02 (Open)](/task/031-task-02)

- [031 Task 13 (Open)](/task/031-task-13)

- [031 Task 14 (Open)](/task/031-task-14)

- [031 Task 15 (Open)](/task/031-task-15)

End of tasks.
`);
});

test("two adjacent existing tasks to the bottom third from the top third; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 032

## Subtasks

- 032 Task 01 (Open)
- 032 Task 02 (Open)
- 032 Task 03 (Open)
- 032 Task 04 (Open)
- 032 Task 05 (Open)
- 032 Task 06 (Open)
- 032 Task 07 (Open)
- 032 Task 08 (Open)
- 032 Task 09 (Open)
- 032 Task 10 (Open)
- 032 Task 11 (Open)
- 032 Task 12 (Open)
- 032 Task 13 (Open)
- 032 Task 14 (Open)
- 032 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 032](/task/parent-032).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-032 --limit 100kb >/dev/null
alpine update /task/parent-032 \\
  --old '- [032 Task 01 (Open)](/task/032-task-01)

- [032 Task 02 (Open)](/task/032-task-02)

- [032 Task 03 (Open)](/task/032-task-03)

- [032 Task 04 (Open)](/task/032-task-04)

- [032 Task 05 (Open)](/task/032-task-05)

- [032 Task 06 (Open)](/task/032-task-06)

- [032 Task 07 (Open)](/task/032-task-07)

- [032 Task 08 (Open)](/task/032-task-08)

- [032 Task 09 (Open)](/task/032-task-09)

- [032 Task 10 (Open)](/task/032-task-10)

- [032 Task 11 (Open)](/task/032-task-11)

- [032 Task 12 (Open)](/task/032-task-12)

- [032 Task 13 (Open)](/task/032-task-13)

- [032 Task 14 (Open)](/task/032-task-14)

- [032 Task 15 (Open)](/task/032-task-15)' \\
  --new '- [032 Task 01 (Open)](/task/032-task-01)

- [032 Task 04 (Open)](/task/032-task-04)

- [032 Task 05 (Open)](/task/032-task-05)

- [032 Task 06 (Open)](/task/032-task-06)

- [032 Task 07 (Open)](/task/032-task-07)

- [032 Task 08 (Open)](/task/032-task-08)

- [032 Task 09 (Open)](/task/032-task-09)

- [032 Task 10 (Open)](/task/032-task-10)

- [032 Task 11 (Open)](/task/032-task-11)

- [032 Task 12 (Open)](/task/032-task-12)

- [032 Task 02 (Open)](/task/032-task-02)

- [032 Task 03 (Open)](/task/032-task-03)

- [032 Task 13 (Open)](/task/032-task-13)

- [032 Task 14 (Open)](/task/032-task-14)

- [032 Task 15 (Open)](/task/032-task-15)'
alpine read /task/parent-032 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 032

- Status: Open

## Subtasks

- [032 Task 01 (Open)](/task/032-task-01)

- [032 Task 04 (Open)](/task/032-task-04)

- [032 Task 05 (Open)](/task/032-task-05)

- [032 Task 06 (Open)](/task/032-task-06)

- [032 Task 07 (Open)](/task/032-task-07)

- [032 Task 08 (Open)](/task/032-task-08)

- [032 Task 09 (Open)](/task/032-task-09)

- [032 Task 10 (Open)](/task/032-task-10)

- [032 Task 11 (Open)](/task/032-task-11)

- [032 Task 12 (Open)](/task/032-task-12)

- [032 Task 02 (Open)](/task/032-task-02)

- [032 Task 03 (Open)](/task/032-task-03)

- [032 Task 13 (Open)](/task/032-task-13)

- [032 Task 14 (Open)](/task/032-task-14)

- [032 Task 15 (Open)](/task/032-task-15)
`);
});

test("two non-adjacent existing tasks to the bottom third from the top third; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 033

## Subtasks

- 033 Task 01 (Open)
- 033 Task 02 (Open)
- 033 Task 03 (Open)
- 033 Task 04 (Open)
- 033 Task 05 (Open)
- 033 Task 06 (Open)
- 033 Task 07 (Open)
- 033 Task 08 (Open)
- 033 Task 09 (Open)
- 033 Task 10 (Open)
- 033 Task 11 (Open)
- 033 Task 12 (Open)
- 033 Task 13 (Open)
- 033 Task 14 (Open)
- 033 Task 15 (Open)
- 033 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 033](/task/parent-033).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-033/subtasks --limit 850b >/dev/null
alpine update /task/parent-033/subtasks \\
  --old '- [033 Task 01 (Open)](/task/033-task-01)

- [033 Task 02 (Open)](/task/033-task-02)

- [033 Task 03 (Open)](/task/033-task-03)

- [033 Task 04 (Open)](/task/033-task-04)

- [033 Task 05 (Open)](/task/033-task-05)

- [033 Task 06 (Open)](/task/033-task-06)

- [033 Task 07 (Open)](/task/033-task-07)

- [033 Task 08 (Open)](/task/033-task-08)

- [033 Task 09 (Open)](/task/033-task-09)

- [033 Task 10 (Open)](/task/033-task-10)

- [033 Task 11 (Open)](/task/033-task-11)

- [033 Task 12 (Open)](/task/033-task-12)

- [033 Task 13 (Open)](/task/033-task-13)

- [033 Task 14 (Open)](/task/033-task-14)

- [033 Task 15 (Open)](/task/033-task-15)' \\
  --new '- [033 Task 01 (Open)](/task/033-task-01)

- [033 Task 03 (Open)](/task/033-task-03)

- [033 Task 04 (Open)](/task/033-task-04)

- [033 Task 06 (Open)](/task/033-task-06)

- [033 Task 07 (Open)](/task/033-task-07)

- [033 Task 08 (Open)](/task/033-task-08)

- [033 Task 09 (Open)](/task/033-task-09)

- [033 Task 10 (Open)](/task/033-task-10)

- [033 Task 11 (Open)](/task/033-task-11)

- [033 Task 12 (Open)](/task/033-task-12)

- [033 Task 02 (Open)](/task/033-task-02)

- [033 Task 05 (Open)](/task/033-task-05)

- [033 Task 13 (Open)](/task/033-task-13)

- [033 Task 14 (Open)](/task/033-task-14)

- [033 Task 15 (Open)](/task/033-task-15)'
alpine read /task/parent-033/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 033 (Open)](/task/parent-033).

- [033 Task 01 (Open)](/task/033-task-01)

- [033 Task 03 (Open)](/task/033-task-03)

- [033 Task 04 (Open)](/task/033-task-04)

- [033 Task 06 (Open)](/task/033-task-06)

- [033 Task 07 (Open)](/task/033-task-07)

- [033 Task 08 (Open)](/task/033-task-08)

- [033 Task 09 (Open)](/task/033-task-09)

- [033 Task 10 (Open)](/task/033-task-10)

- [033 Task 11 (Open)](/task/033-task-11)

- [033 Task 12 (Open)](/task/033-task-12)

- [033 Task 02 (Open)](/task/033-task-02)

- [033 Task 05 (Open)](/task/033-task-05)

- [033 Task 13 (Open)](/task/033-task-13)

- [033 Task 14 (Open)](/task/033-task-14)

- [033 Task 15 (Open)](/task/033-task-15)

- [033 After pagination guard with a deliberately long title (Open)](/task/033-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five existing tasks to the bottom third from the top third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 034

## Subtasks

- 034 Before (Open)
- 034 Task 01 (Open)
- 034 Task 02 (Open)
- 034 Task 03 (Open)
- 034 Task 04 (Open)
- 034 Task 05 (Open)
- 034 Task 06 (Open)
- 034 Task 07 (Open)
- 034 Task 08 (Open)
- 034 Task 09 (Open)
- 034 Task 10 (Open)
- 034 Task 11 (Open)
- 034 Task 12 (Open)
- 034 Task 13 (Open)
- 034 Task 14 (Open)
- 034 Task 15 (Open)
- 034 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 034](/task/parent-034).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-034/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [034 Task 01 (Open)](/task/034-task-01)

- [034 Task 02 (Open)](/task/034-task-02)

- [034 Task 03 (Open)](/task/034-task-03)

- [034 Task 04 (Open)](/task/034-task-04)

- [034 Task 05 (Open)](/task/034-task-05)

- [034 Task 06 (Open)](/task/034-task-06)

- [034 Task 07 (Open)](/task/034-task-07)

- [034 Task 08 (Open)](/task/034-task-08)

- [034 Task 09 (Open)](/task/034-task-09)

- [034 Task 10 (Open)](/task/034-task-10)

- [034 Task 11 (Open)](/task/034-task-11)

- [034 Task 12 (Open)](/task/034-task-12)

- [034 Task 13 (Open)](/task/034-task-13)

- [034 Task 14 (Open)](/task/034-task-14)

- [034 Task 15 (Open)](/task/034-task-15)' \\
  --new '- [034 Task 01 (Open)](/task/034-task-01)

- [034 Task 07 (Open)](/task/034-task-07)

- [034 Task 08 (Open)](/task/034-task-08)

- [034 Task 09 (Open)](/task/034-task-09)

- [034 Task 10 (Open)](/task/034-task-10)

- [034 Task 11 (Open)](/task/034-task-11)

- [034 Task 12 (Open)](/task/034-task-12)

- [034 Task 02 (Open)](/task/034-task-02)

- [034 Task 03 (Open)](/task/034-task-03)

- [034 Task 04 (Open)](/task/034-task-04)

- [034 Task 05 (Open)](/task/034-task-05)

- [034 Task 06 (Open)](/task/034-task-06)

- [034 Task 13 (Open)](/task/034-task-13)

- [034 Task 14 (Open)](/task/034-task-14)

- [034 Task 15 (Open)](/task/034-task-15)'
alpine read /task/parent-034/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 034 (Open)](/task/parent-034).

- [034 Before (Open)](/task/034-before)

- [034 Task 01 (Open)](/task/034-task-01)

- [034 Task 07 (Open)](/task/034-task-07)

- [034 Task 08 (Open)](/task/034-task-08)

- [034 Task 09 (Open)](/task/034-task-09)

- [034 Task 10 (Open)](/task/034-task-10)

- [034 Task 11 (Open)](/task/034-task-11)

- [034 Task 12 (Open)](/task/034-task-12)

- [034 Task 02 (Open)](/task/034-task-02)

- [034 Task 03 (Open)](/task/034-task-03)

- [034 Task 04 (Open)](/task/034-task-04)

- [034 Task 05 (Open)](/task/034-task-05)

- [034 Task 06 (Open)](/task/034-task-06)

- [034 Task 13 (Open)](/task/034-task-13)

- [034 Task 14 (Open)](/task/034-task-14)

- [034 Task 15 (Open)](/task/034-task-15)

- [034 After pagination guard with a deliberately long title (Open)](/task/034-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one newly created task to the bottom third from the top third; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 035

## Subtasks

- 035 Before (Open)
- 035 Task 01 (Open)
- 035 Task 02 (Open)
- 035 Task 03 (Open)
- 035 Task 04 (Open)
- 035 Task 05 (Open)
- 035 Task 06 (Open)
- 035 Task 07 (Open)
- 035 Task 08 (Open)
- 035 Task 09 (Open)
- 035 Task 10 (Open)
- 035 Task 11 (Open)
- 035 Task 12 (Open)
- 035 Task 13 (Open)
- 035 Task 14 (Open)
- 035 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 035](/task/parent-035).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-035/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [035 Task 01 (Open)](/task/035-task-01)

- [035 Task 02 (Open)](/task/035-task-02)

- [035 Task 03 (Open)](/task/035-task-03)

- [035 Task 04 (Open)](/task/035-task-04)

- [035 Task 05 (Open)](/task/035-task-05)

- [035 Task 06 (Open)](/task/035-task-06)

- [035 Task 07 (Open)](/task/035-task-07)

- [035 Task 08 (Open)](/task/035-task-08)

- [035 Task 09 (Open)](/task/035-task-09)

- [035 Task 10 (Open)](/task/035-task-10)

- [035 Task 11 (Open)](/task/035-task-11)

- [035 Task 12 (Open)](/task/035-task-12)

- [035 Task 13 (Open)](/task/035-task-13)

- [035 Task 14 (Open)](/task/035-task-14)

- [035 Task 15 (Open)](/task/035-task-15)' \\
  --new '- [035 Task 01 (Open)](/task/035-task-01)

- [035 Task 02 (Open)](/task/035-task-02)

- [035 Task 03 (Open)](/task/035-task-03)

- [035 Task 04 (Open)](/task/035-task-04)

- [035 Task 05 (Open)](/task/035-task-05)

- [035 Task 06 (Open)](/task/035-task-06)

- [035 Task 07 (Open)](/task/035-task-07)

- [035 Task 08 (Open)](/task/035-task-08)

- [035 Task 09 (Open)](/task/035-task-09)

- [035 Task 10 (Open)](/task/035-task-10)

- [035 Task 11 (Open)](/task/035-task-11)

- [035 Task 12 (Open)](/task/035-task-12)

- 035 Moved new 1 (Open)

- [035 Task 13 (Open)](/task/035-task-13)

- [035 Task 14 (Open)](/task/035-task-14)

- [035 Task 15 (Open)](/task/035-task-15)'
alpine read /task/parent-035/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 035 (Open)](/task/parent-035).

- [035 Before (Open)](/task/035-before)

- [035 Task 01 (Open)](/task/035-task-01)

- [035 Task 02 (Open)](/task/035-task-02)

- [035 Task 03 (Open)](/task/035-task-03)

- [035 Task 04 (Open)](/task/035-task-04)

- [035 Task 05 (Open)](/task/035-task-05)

- [035 Task 06 (Open)](/task/035-task-06)

- [035 Task 07 (Open)](/task/035-task-07)

- [035 Task 08 (Open)](/task/035-task-08)

- [035 Task 09 (Open)](/task/035-task-09)

- [035 Task 10 (Open)](/task/035-task-10)

- [035 Task 11 (Open)](/task/035-task-11)

- [035 Task 12 (Open)](/task/035-task-12)

- [035 Moved new 1 (Open)](/task/035-moved-new-1)

- [035 Task 13 (Open)](/task/035-task-13)

- [035 Task 14 (Open)](/task/035-task-14)

- [035 Task 15 (Open)](/task/035-task-15)

End of tasks.
`);
});

test("two newly created tasks to the bottom third from the top third; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 036

- 036 Task 01 (Open)
- 036 Task 02 (Open)
- 036 Task 03 (Open)
- 036 Task 04 (Open)
- 036 Task 05 (Open)
- 036 Task 06 (Open)
- 036 Task 07 (Open)
- 036 Task 08 (Open)
- 036 Task 09 (Open)
- 036 Task 10 (Open)
- 036 Task 11 (Open)
- 036 Task 12 (Open)
- 036 Task 13 (Open)
- 036 Task 14 (Open)
- 036 Task 15 (Open)
- 036 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 036](/task-collection/roadmap-036).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-036 --limit 850b >/dev/null
alpine update /task-collection/roadmap-036 \\
  --old '- [036 Task 01 (Open)](/task/036-task-01)

- [036 Task 02 (Open)](/task/036-task-02)

- [036 Task 03 (Open)](/task/036-task-03)

- [036 Task 04 (Open)](/task/036-task-04)

- [036 Task 05 (Open)](/task/036-task-05)

- [036 Task 06 (Open)](/task/036-task-06)

- [036 Task 07 (Open)](/task/036-task-07)

- [036 Task 08 (Open)](/task/036-task-08)

- [036 Task 09 (Open)](/task/036-task-09)

- [036 Task 10 (Open)](/task/036-task-10)

- [036 Task 11 (Open)](/task/036-task-11)

- [036 Task 12 (Open)](/task/036-task-12)

- [036 Task 13 (Open)](/task/036-task-13)

- [036 Task 14 (Open)](/task/036-task-14)

- [036 Task 15 (Open)](/task/036-task-15)' \\
  --new '- [036 Task 01 (Open)](/task/036-task-01)

- [036 Task 02 (Open)](/task/036-task-02)

- [036 Task 03 (Open)](/task/036-task-03)

- [036 Task 04 (Open)](/task/036-task-04)

- [036 Task 05 (Open)](/task/036-task-05)

- [036 Task 06 (Open)](/task/036-task-06)

- [036 Task 07 (Open)](/task/036-task-07)

- [036 Task 08 (Open)](/task/036-task-08)

- [036 Task 09 (Open)](/task/036-task-09)

- [036 Task 10 (Open)](/task/036-task-10)

- [036 Task 11 (Open)](/task/036-task-11)

- [036 Task 12 (Open)](/task/036-task-12)

- 036 Moved new 1 (Open)

- 036 Moved new 2 (Open)

- [036 Task 13 (Open)](/task/036-task-13)

- [036 Task 14 (Open)](/task/036-task-14)

- [036 Task 15 (Open)](/task/036-task-15)'
alpine read /task-collection/roadmap-036 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 036

- [036 Task 01 (Open)](/task/036-task-01)

- [036 Task 02 (Open)](/task/036-task-02)

- [036 Task 03 (Open)](/task/036-task-03)

- [036 Task 04 (Open)](/task/036-task-04)

- [036 Task 05 (Open)](/task/036-task-05)

- [036 Task 06 (Open)](/task/036-task-06)

- [036 Task 07 (Open)](/task/036-task-07)

- [036 Task 08 (Open)](/task/036-task-08)

- [036 Task 09 (Open)](/task/036-task-09)

- [036 Task 10 (Open)](/task/036-task-10)

- [036 Task 11 (Open)](/task/036-task-11)

- [036 Task 12 (Open)](/task/036-task-12)

- [036 Moved new 1 (Open)](/task/036-moved-new-1)

- [036 Moved new 2 (Open)](/task/036-moved-new-2)

- [036 Task 13 (Open)](/task/036-task-13)

- [036 Task 14 (Open)](/task/036-task-14)

- [036 Task 15 (Open)](/task/036-task-15)

- [036 After pagination guard with a deliberately long title (Open)](/task/036-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five newly created tasks to the bottom third from the top third; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 037

- 037 Before (Open)
- 037 Task 01 (Open)
- 037 Task 02 (Open)
- 037 Task 03 (Open)
- 037 Task 04 (Open)
- 037 Task 05 (Open)
- 037 Task 06 (Open)
- 037 Task 07 (Open)
- 037 Task 08 (Open)
- 037 Task 09 (Open)
- 037 Task 10 (Open)
- 037 Task 11 (Open)
- 037 Task 12 (Open)
- 037 Task 13 (Open)
- 037 Task 14 (Open)
- 037 Task 15 (Open)
- 037 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 037](/task-collection/roadmap-037).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-037 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [037 Task 01 (Open)](/task/037-task-01)

- [037 Task 02 (Open)](/task/037-task-02)

- [037 Task 03 (Open)](/task/037-task-03)

- [037 Task 04 (Open)](/task/037-task-04)

- [037 Task 05 (Open)](/task/037-task-05)

- [037 Task 06 (Open)](/task/037-task-06)

- [037 Task 07 (Open)](/task/037-task-07)

- [037 Task 08 (Open)](/task/037-task-08)

- [037 Task 09 (Open)](/task/037-task-09)

- [037 Task 10 (Open)](/task/037-task-10)

- [037 Task 11 (Open)](/task/037-task-11)

- [037 Task 12 (Open)](/task/037-task-12)

- [037 Task 13 (Open)](/task/037-task-13)

- [037 Task 14 (Open)](/task/037-task-14)

- [037 Task 15 (Open)](/task/037-task-15)' \\
  --new '- [037 Task 01 (Open)](/task/037-task-01)

- [037 Task 02 (Open)](/task/037-task-02)

- [037 Task 03 (Open)](/task/037-task-03)

- [037 Task 04 (Open)](/task/037-task-04)

- [037 Task 05 (Open)](/task/037-task-05)

- [037 Task 06 (Open)](/task/037-task-06)

- [037 Task 07 (Open)](/task/037-task-07)

- [037 Task 08 (Open)](/task/037-task-08)

- [037 Task 09 (Open)](/task/037-task-09)

- [037 Task 10 (Open)](/task/037-task-10)

- [037 Task 11 (Open)](/task/037-task-11)

- [037 Task 12 (Open)](/task/037-task-12)

- 037 Moved new 1 (Open)

- 037 Moved new 2 (Open)

- 037 Moved new 3 (Open)

- 037 Moved new 4 (Open)

- 037 Moved new 5 (Open)

- [037 Task 13 (Open)](/task/037-task-13)

- [037 Task 14 (Open)](/task/037-task-14)

- [037 Task 15 (Open)](/task/037-task-15)'
alpine read /task-collection/roadmap-037 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 037

- [037 Before (Open)](/task/037-before)

- [037 Task 01 (Open)](/task/037-task-01)

- [037 Task 02 (Open)](/task/037-task-02)

- [037 Task 03 (Open)](/task/037-task-03)

- [037 Task 04 (Open)](/task/037-task-04)

- [037 Task 05 (Open)](/task/037-task-05)

- [037 Task 06 (Open)](/task/037-task-06)

- [037 Task 07 (Open)](/task/037-task-07)

- [037 Task 08 (Open)](/task/037-task-08)

- [037 Task 09 (Open)](/task/037-task-09)

- [037 Task 10 (Open)](/task/037-task-10)

- [037 Task 11 (Open)](/task/037-task-11)

- [037 Task 12 (Open)](/task/037-task-12)

- [037 Moved new 1 (Open)](/task/037-moved-new-1)

- [037 Moved new 2 (Open)](/task/037-moved-new-2)

- [037 Moved new 3 (Open)](/task/037-moved-new-3)

- [037 Moved new 4 (Open)](/task/037-moved-new-4)

- [037 Moved new 5 (Open)](/task/037-moved-new-5)

- [037 Task 13 (Open)](/task/037-task-13)

- [037 Task 14 (Open)](/task/037-task-14)

- [037 Task 15 (Open)](/task/037-task-15)

- [037 After pagination guard with a deliberately long title (Open)](/task/037-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one task created by the previous update to the bottom third from the top third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 038

- 038 Before (Open)
- 038 Task 01 (Open)
- 038 Task 02 (Open)
- 038 Task 03 (Open)
- 038 Task 04 (Open)
- 038 Task 05 (Open)
- 038 Task 06 (Open)
- 038 Task 07 (Open)
- 038 Task 08 (Open)
- 038 Task 09 (Open)
- 038 Task 10 (Open)
- 038 Task 11 (Open)
- 038 Task 12 (Open)
- 038 Task 13 (Open)
- 038 Task 14 (Open)
- 038 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 038](/task-collection/roadmap-038).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-038 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [038 Task 01 (Open)](/task/038-task-01)

- [038 Task 02 (Open)](/task/038-task-02)

- [038 Task 03 (Open)](/task/038-task-03)

- [038 Task 04 (Open)](/task/038-task-04)

- [038 Task 05 (Open)](/task/038-task-05)

- [038 Task 06 (Open)](/task/038-task-06)

- [038 Task 07 (Open)](/task/038-task-07)

- [038 Task 08 (Open)](/task/038-task-08)

- [038 Task 09 (Open)](/task/038-task-09)

- [038 Task 10 (Open)](/task/038-task-10)

- [038 Task 11 (Open)](/task/038-task-11)

- [038 Task 12 (Open)](/task/038-task-12)

- [038 Task 13 (Open)](/task/038-task-13)

- [038 Task 14 (Open)](/task/038-task-14)

- [038 Task 15 (Open)](/task/038-task-15)' \\
  --new '- [038 Task 01 (Open)](/task/038-task-01)

- [038 Task 02 (Open)](/task/038-task-02)

- 038 Moved previous 1 (Open)

- [038 Task 03 (Open)](/task/038-task-03)

- [038 Task 04 (Open)](/task/038-task-04)

- [038 Task 05 (Open)](/task/038-task-05)

- [038 Task 06 (Open)](/task/038-task-06)

- [038 Task 07 (Open)](/task/038-task-07)

- [038 Task 08 (Open)](/task/038-task-08)

- [038 Task 09 (Open)](/task/038-task-09)

- [038 Task 10 (Open)](/task/038-task-10)

- [038 Task 11 (Open)](/task/038-task-11)

- [038 Task 12 (Open)](/task/038-task-12)

- [038 Task 13 (Open)](/task/038-task-13)

- [038 Task 14 (Open)](/task/038-task-14)

- [038 Task 15 (Open)](/task/038-task-15)'
alpine update $path \\
  --old '- [038 Task 01 (Open)](/task/038-task-01)

- [038 Task 02 (Open)](/task/038-task-02)

- 038 Moved previous 1 (Open)

- [038 Task 03 (Open)](/task/038-task-03)

- [038 Task 04 (Open)](/task/038-task-04)

- [038 Task 05 (Open)](/task/038-task-05)

- [038 Task 06 (Open)](/task/038-task-06)

- [038 Task 07 (Open)](/task/038-task-07)

- [038 Task 08 (Open)](/task/038-task-08)

- [038 Task 09 (Open)](/task/038-task-09)

- [038 Task 10 (Open)](/task/038-task-10)

- [038 Task 11 (Open)](/task/038-task-11)

- [038 Task 12 (Open)](/task/038-task-12)

- [038 Task 13 (Open)](/task/038-task-13)

- [038 Task 14 (Open)](/task/038-task-14)

- [038 Task 15 (Open)](/task/038-task-15)' \\
  --new '- [038 Task 01 (Open)](/task/038-task-01)

- [038 Task 02 (Open)](/task/038-task-02)

- [038 Task 03 (Open)](/task/038-task-03)

- [038 Task 04 (Open)](/task/038-task-04)

- [038 Task 05 (Open)](/task/038-task-05)

- [038 Task 06 (Open)](/task/038-task-06)

- [038 Task 07 (Open)](/task/038-task-07)

- [038 Task 08 (Open)](/task/038-task-08)

- [038 Task 09 (Open)](/task/038-task-09)

- [038 Task 10 (Open)](/task/038-task-10)

- [038 Task 11 (Open)](/task/038-task-11)

- [038 Task 12 (Open)](/task/038-task-12)

- 038 Moved previous 1 (Open)

- [038 Task 13 (Open)](/task/038-task-13)

- [038 Task 14 (Open)](/task/038-task-14)

- [038 Task 15 (Open)](/task/038-task-15)'
alpine read /task-collection/roadmap-038 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 038

- [038 Before (Open)](/task/038-before)

- [038 Task 01 (Open)](/task/038-task-01)

- [038 Task 02 (Open)](/task/038-task-02)

- [038 Task 03 (Open)](/task/038-task-03)

- [038 Task 04 (Open)](/task/038-task-04)

- [038 Task 05 (Open)](/task/038-task-05)

- [038 Task 06 (Open)](/task/038-task-06)

- [038 Task 07 (Open)](/task/038-task-07)

- [038 Task 08 (Open)](/task/038-task-08)

- [038 Task 09 (Open)](/task/038-task-09)

- [038 Task 10 (Open)](/task/038-task-10)

- [038 Task 11 (Open)](/task/038-task-11)

- [038 Task 12 (Open)](/task/038-task-12)

- [038 Moved previous 1 (Open)](/task/038-moved-previous-1)

- [038 Task 13 (Open)](/task/038-task-13)

- [038 Task 14 (Open)](/task/038-task-14)

- [038 Task 15 (Open)](/task/038-task-15)

End of tasks.
`);
});

test("two tasks created by the previous update to the bottom third from the top third; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 039

## Subtasks

- 039 Task 01 (Open)
- 039 Task 02 (Open)
- 039 Task 03 (Open)
- 039 Task 04 (Open)
- 039 Task 05 (Open)
- 039 Task 06 (Open)
- 039 Task 07 (Open)
- 039 Task 08 (Open)
- 039 Task 09 (Open)
- 039 Task 10 (Open)
- 039 Task 11 (Open)
- 039 Task 12 (Open)
- 039 Task 13 (Open)
- 039 Task 14 (Open)
- 039 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 039](/task/parent-039).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-039 --limit 100kb >/dev/null
alpine update /task/parent-039 \\
  --old '- [039 Task 01 (Open)](/task/039-task-01)

- [039 Task 02 (Open)](/task/039-task-02)

- [039 Task 03 (Open)](/task/039-task-03)

- [039 Task 04 (Open)](/task/039-task-04)

- [039 Task 05 (Open)](/task/039-task-05)

- [039 Task 06 (Open)](/task/039-task-06)

- [039 Task 07 (Open)](/task/039-task-07)

- [039 Task 08 (Open)](/task/039-task-08)

- [039 Task 09 (Open)](/task/039-task-09)

- [039 Task 10 (Open)](/task/039-task-10)

- [039 Task 11 (Open)](/task/039-task-11)

- [039 Task 12 (Open)](/task/039-task-12)

- [039 Task 13 (Open)](/task/039-task-13)

- [039 Task 14 (Open)](/task/039-task-14)

- [039 Task 15 (Open)](/task/039-task-15)' \\
  --new '- [039 Task 01 (Open)](/task/039-task-01)

- [039 Task 02 (Open)](/task/039-task-02)

- 039 Moved previous 1 (Open)

- 039 Moved previous 2 (Open)

- [039 Task 03 (Open)](/task/039-task-03)

- [039 Task 04 (Open)](/task/039-task-04)

- [039 Task 05 (Open)](/task/039-task-05)

- [039 Task 06 (Open)](/task/039-task-06)

- [039 Task 07 (Open)](/task/039-task-07)

- [039 Task 08 (Open)](/task/039-task-08)

- [039 Task 09 (Open)](/task/039-task-09)

- [039 Task 10 (Open)](/task/039-task-10)

- [039 Task 11 (Open)](/task/039-task-11)

- [039 Task 12 (Open)](/task/039-task-12)

- [039 Task 13 (Open)](/task/039-task-13)

- [039 Task 14 (Open)](/task/039-task-14)

- [039 Task 15 (Open)](/task/039-task-15)'
alpine update /task/parent-039 \\
  --old '- [039 Task 01 (Open)](/task/039-task-01)

- [039 Task 02 (Open)](/task/039-task-02)

- 039 Moved previous 1 (Open)

- 039 Moved previous 2 (Open)

- [039 Task 03 (Open)](/task/039-task-03)

- [039 Task 04 (Open)](/task/039-task-04)

- [039 Task 05 (Open)](/task/039-task-05)

- [039 Task 06 (Open)](/task/039-task-06)

- [039 Task 07 (Open)](/task/039-task-07)

- [039 Task 08 (Open)](/task/039-task-08)

- [039 Task 09 (Open)](/task/039-task-09)

- [039 Task 10 (Open)](/task/039-task-10)

- [039 Task 11 (Open)](/task/039-task-11)

- [039 Task 12 (Open)](/task/039-task-12)

- [039 Task 13 (Open)](/task/039-task-13)

- [039 Task 14 (Open)](/task/039-task-14)

- [039 Task 15 (Open)](/task/039-task-15)' \\
  --new '- [039 Task 01 (Open)](/task/039-task-01)

- [039 Task 02 (Open)](/task/039-task-02)

- [039 Task 03 (Open)](/task/039-task-03)

- [039 Task 04 (Open)](/task/039-task-04)

- [039 Task 05 (Open)](/task/039-task-05)

- [039 Task 06 (Open)](/task/039-task-06)

- [039 Task 07 (Open)](/task/039-task-07)

- [039 Task 08 (Open)](/task/039-task-08)

- [039 Task 09 (Open)](/task/039-task-09)

- [039 Task 10 (Open)](/task/039-task-10)

- [039 Task 11 (Open)](/task/039-task-11)

- [039 Task 12 (Open)](/task/039-task-12)

- 039 Moved previous 1 (Open)

- 039 Moved previous 2 (Open)

- [039 Task 13 (Open)](/task/039-task-13)

- [039 Task 14 (Open)](/task/039-task-14)

- [039 Task 15 (Open)](/task/039-task-15)'
alpine read /task/parent-039 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 039

- Status: Open

## Subtasks

- [039 Task 01 (Open)](/task/039-task-01)

- [039 Task 02 (Open)](/task/039-task-02)

- [039 Task 03 (Open)](/task/039-task-03)

- [039 Task 04 (Open)](/task/039-task-04)

- [039 Task 05 (Open)](/task/039-task-05)

- [039 Task 06 (Open)](/task/039-task-06)

- [039 Task 07 (Open)](/task/039-task-07)

- [039 Task 08 (Open)](/task/039-task-08)

- [039 Task 09 (Open)](/task/039-task-09)

- [039 Task 10 (Open)](/task/039-task-10)

- [039 Task 11 (Open)](/task/039-task-11)

- [039 Task 12 (Open)](/task/039-task-12)

- [039 Moved previous 1 (Open)](/task/039-moved-previous-1)

- [039 Moved previous 2 (Open)](/task/039-moved-previous-2)

- [039 Task 13 (Open)](/task/039-task-13)

- [039 Task 14 (Open)](/task/039-task-14)

- [039 Task 15 (Open)](/task/039-task-15)
`);
});

test("five tasks created by the previous update to the bottom third from the top third; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 040

## Subtasks

- 040 Task 01 (Open)
- 040 Task 02 (Open)
- 040 Task 03 (Open)
- 040 Task 04 (Open)
- 040 Task 05 (Open)
- 040 Task 06 (Open)
- 040 Task 07 (Open)
- 040 Task 08 (Open)
- 040 Task 09 (Open)
- 040 Task 10 (Open)
- 040 Task 11 (Open)
- 040 Task 12 (Open)
- 040 Task 13 (Open)
- 040 Task 14 (Open)
- 040 Task 15 (Open)
- 040 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 040](/task/parent-040).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-040/subtasks --limit 850b >/dev/null
alpine update /task/parent-040/subtasks \\
  --old '- [040 Task 01 (Open)](/task/040-task-01)

- [040 Task 02 (Open)](/task/040-task-02)

- [040 Task 03 (Open)](/task/040-task-03)

- [040 Task 04 (Open)](/task/040-task-04)

- [040 Task 05 (Open)](/task/040-task-05)

- [040 Task 06 (Open)](/task/040-task-06)

- [040 Task 07 (Open)](/task/040-task-07)

- [040 Task 08 (Open)](/task/040-task-08)

- [040 Task 09 (Open)](/task/040-task-09)

- [040 Task 10 (Open)](/task/040-task-10)

- [040 Task 11 (Open)](/task/040-task-11)

- [040 Task 12 (Open)](/task/040-task-12)

- [040 Task 13 (Open)](/task/040-task-13)

- [040 Task 14 (Open)](/task/040-task-14)

- [040 Task 15 (Open)](/task/040-task-15)' \\
  --new '- [040 Task 01 (Open)](/task/040-task-01)

- [040 Task 02 (Open)](/task/040-task-02)

- 040 Moved previous 1 (Open)

- 040 Moved previous 2 (Open)

- 040 Moved previous 3 (Open)

- 040 Moved previous 4 (Open)

- 040 Moved previous 5 (Open)

- [040 Task 03 (Open)](/task/040-task-03)

- [040 Task 04 (Open)](/task/040-task-04)

- [040 Task 05 (Open)](/task/040-task-05)

- [040 Task 06 (Open)](/task/040-task-06)

- [040 Task 07 (Open)](/task/040-task-07)

- [040 Task 08 (Open)](/task/040-task-08)

- [040 Task 09 (Open)](/task/040-task-09)

- [040 Task 10 (Open)](/task/040-task-10)

- [040 Task 11 (Open)](/task/040-task-11)

- [040 Task 12 (Open)](/task/040-task-12)

- [040 Task 13 (Open)](/task/040-task-13)

- [040 Task 14 (Open)](/task/040-task-14)

- [040 Task 15 (Open)](/task/040-task-15)'
alpine update /task/parent-040/subtasks \\
  --old '- [040 Task 01 (Open)](/task/040-task-01)

- [040 Task 02 (Open)](/task/040-task-02)

- 040 Moved previous 1 (Open)

- 040 Moved previous 2 (Open)

- 040 Moved previous 3 (Open)

- 040 Moved previous 4 (Open)

- 040 Moved previous 5 (Open)

- [040 Task 03 (Open)](/task/040-task-03)

- [040 Task 04 (Open)](/task/040-task-04)

- [040 Task 05 (Open)](/task/040-task-05)

- [040 Task 06 (Open)](/task/040-task-06)

- [040 Task 07 (Open)](/task/040-task-07)

- [040 Task 08 (Open)](/task/040-task-08)

- [040 Task 09 (Open)](/task/040-task-09)

- [040 Task 10 (Open)](/task/040-task-10)

- [040 Task 11 (Open)](/task/040-task-11)

- [040 Task 12 (Open)](/task/040-task-12)

- [040 Task 13 (Open)](/task/040-task-13)

- [040 Task 14 (Open)](/task/040-task-14)

- [040 Task 15 (Open)](/task/040-task-15)' \\
  --new '- [040 Task 01 (Open)](/task/040-task-01)

- [040 Task 02 (Open)](/task/040-task-02)

- [040 Task 03 (Open)](/task/040-task-03)

- [040 Task 04 (Open)](/task/040-task-04)

- [040 Task 05 (Open)](/task/040-task-05)

- [040 Task 06 (Open)](/task/040-task-06)

- [040 Task 07 (Open)](/task/040-task-07)

- [040 Task 08 (Open)](/task/040-task-08)

- [040 Task 09 (Open)](/task/040-task-09)

- [040 Task 10 (Open)](/task/040-task-10)

- [040 Task 11 (Open)](/task/040-task-11)

- [040 Task 12 (Open)](/task/040-task-12)

- 040 Moved previous 1 (Open)

- 040 Moved previous 2 (Open)

- 040 Moved previous 3 (Open)

- 040 Moved previous 4 (Open)

- 040 Moved previous 5 (Open)

- [040 Task 13 (Open)](/task/040-task-13)

- [040 Task 14 (Open)](/task/040-task-14)

- [040 Task 15 (Open)](/task/040-task-15)'
alpine read /task/parent-040/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 040 (Open)](/task/parent-040).

- [040 Task 01 (Open)](/task/040-task-01)

- [040 Task 02 (Open)](/task/040-task-02)

- [040 Task 03 (Open)](/task/040-task-03)

- [040 Task 04 (Open)](/task/040-task-04)

- [040 Task 05 (Open)](/task/040-task-05)

- [040 Task 06 (Open)](/task/040-task-06)

- [040 Task 07 (Open)](/task/040-task-07)

- [040 Task 08 (Open)](/task/040-task-08)

- [040 Task 09 (Open)](/task/040-task-09)

- [040 Task 10 (Open)](/task/040-task-10)

- [040 Task 11 (Open)](/task/040-task-11)

- [040 Task 12 (Open)](/task/040-task-12)

- [040 Moved previous 1 (Open)](/task/040-moved-previous-1)

- [040 Moved previous 2 (Open)](/task/040-moved-previous-2)

- [040 Moved previous 3 (Open)](/task/040-moved-previous-3)

- [040 Moved previous 4 (Open)](/task/040-moved-previous-4)

- [040 Moved previous 5 (Open)](/task/040-moved-previous-5)

- [040 Task 13 (Open)](/task/040-task-13)

- [040 Task 14 (Open)](/task/040-task-14)

- [040 Task 15 (Open)](/task/040-task-15)

- [040 After pagination guard with a deliberately long title (Open)](/task/040-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing then one newly created task to the bottom third from the top third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 041

## Subtasks

- 041 Before (Open)
- 041 Task 01 (Open)
- 041 Task 02 (Open)
- 041 Task 03 (Open)
- 041 Task 04 (Open)
- 041 Task 05 (Open)
- 041 Task 06 (Open)
- 041 Task 07 (Open)
- 041 Task 08 (Open)
- 041 Task 09 (Open)
- 041 Task 10 (Open)
- 041 Task 11 (Open)
- 041 Task 12 (Open)
- 041 Task 13 (Open)
- 041 Task 14 (Open)
- 041 Task 15 (Open)
- 041 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 041](/task/parent-041).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-041/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [041 Task 01 (Open)](/task/041-task-01)

- [041 Task 02 (Open)](/task/041-task-02)

- [041 Task 03 (Open)](/task/041-task-03)

- [041 Task 04 (Open)](/task/041-task-04)

- [041 Task 05 (Open)](/task/041-task-05)

- [041 Task 06 (Open)](/task/041-task-06)

- [041 Task 07 (Open)](/task/041-task-07)

- [041 Task 08 (Open)](/task/041-task-08)

- [041 Task 09 (Open)](/task/041-task-09)

- [041 Task 10 (Open)](/task/041-task-10)

- [041 Task 11 (Open)](/task/041-task-11)

- [041 Task 12 (Open)](/task/041-task-12)

- [041 Task 13 (Open)](/task/041-task-13)

- [041 Task 14 (Open)](/task/041-task-14)

- [041 Task 15 (Open)](/task/041-task-15)' \\
  --new '- [041 Task 01 (Open)](/task/041-task-01)

- [041 Task 03 (Open)](/task/041-task-03)

- [041 Task 04 (Open)](/task/041-task-04)

- [041 Task 05 (Open)](/task/041-task-05)

- [041 Task 06 (Open)](/task/041-task-06)

- [041 Task 07 (Open)](/task/041-task-07)

- [041 Task 08 (Open)](/task/041-task-08)

- [041 Task 09 (Open)](/task/041-task-09)

- [041 Task 10 (Open)](/task/041-task-10)

- [041 Task 11 (Open)](/task/041-task-11)

- [041 Task 12 (Open)](/task/041-task-12)

- [041 Task 02 (Open)](/task/041-task-02)

- 041 Moved new 1 (Open)

- [041 Task 13 (Open)](/task/041-task-13)

- [041 Task 14 (Open)](/task/041-task-14)

- [041 Task 15 (Open)](/task/041-task-15)'
alpine read /task/parent-041/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 041 (Open)](/task/parent-041).

- [041 Before (Open)](/task/041-before)

- [041 Task 01 (Open)](/task/041-task-01)

- [041 Task 03 (Open)](/task/041-task-03)

- [041 Task 04 (Open)](/task/041-task-04)

- [041 Task 05 (Open)](/task/041-task-05)

- [041 Task 06 (Open)](/task/041-task-06)

- [041 Task 07 (Open)](/task/041-task-07)

- [041 Task 08 (Open)](/task/041-task-08)

- [041 Task 09 (Open)](/task/041-task-09)

- [041 Task 10 (Open)](/task/041-task-10)

- [041 Task 11 (Open)](/task/041-task-11)

- [041 Task 12 (Open)](/task/041-task-12)

- [041 Task 02 (Open)](/task/041-task-02)

- [041 Moved new 1 (Open)](/task/041-moved-new-1)

- [041 Task 13 (Open)](/task/041-task-13)

- [041 Task 14 (Open)](/task/041-task-14)

- [041 Task 15 (Open)](/task/041-task-15)

- [041 After pagination guard with a deliberately long title (Open)](/task/041-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one newly created then one existing task to the bottom third from the top third; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 042

## Subtasks

- 042 Before (Open)
- 042 Task 01 (Open)
- 042 Task 02 (Open)
- 042 Task 03 (Open)
- 042 Task 04 (Open)
- 042 Task 05 (Open)
- 042 Task 06 (Open)
- 042 Task 07 (Open)
- 042 Task 08 (Open)
- 042 Task 09 (Open)
- 042 Task 10 (Open)
- 042 Task 11 (Open)
- 042 Task 12 (Open)
- 042 Task 13 (Open)
- 042 Task 14 (Open)
- 042 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 042](/task/parent-042).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-042/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [042 Task 01 (Open)](/task/042-task-01)

- [042 Task 02 (Open)](/task/042-task-02)

- [042 Task 03 (Open)](/task/042-task-03)

- [042 Task 04 (Open)](/task/042-task-04)

- [042 Task 05 (Open)](/task/042-task-05)

- [042 Task 06 (Open)](/task/042-task-06)

- [042 Task 07 (Open)](/task/042-task-07)

- [042 Task 08 (Open)](/task/042-task-08)

- [042 Task 09 (Open)](/task/042-task-09)

- [042 Task 10 (Open)](/task/042-task-10)

- [042 Task 11 (Open)](/task/042-task-11)

- [042 Task 12 (Open)](/task/042-task-12)

- [042 Task 13 (Open)](/task/042-task-13)

- [042 Task 14 (Open)](/task/042-task-14)

- [042 Task 15 (Open)](/task/042-task-15)' \\
  --new '- [042 Task 01 (Open)](/task/042-task-01)

- [042 Task 03 (Open)](/task/042-task-03)

- [042 Task 04 (Open)](/task/042-task-04)

- [042 Task 05 (Open)](/task/042-task-05)

- [042 Task 06 (Open)](/task/042-task-06)

- [042 Task 07 (Open)](/task/042-task-07)

- [042 Task 08 (Open)](/task/042-task-08)

- [042 Task 09 (Open)](/task/042-task-09)

- [042 Task 10 (Open)](/task/042-task-10)

- [042 Task 11 (Open)](/task/042-task-11)

- [042 Task 12 (Open)](/task/042-task-12)

- 042 Moved new 1 (Open)

- [042 Task 02 (Open)](/task/042-task-02)

- [042 Task 13 (Open)](/task/042-task-13)

- [042 Task 14 (Open)](/task/042-task-14)

- [042 Task 15 (Open)](/task/042-task-15)'
alpine read /task/parent-042/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 042 (Open)](/task/parent-042).

- [042 Before (Open)](/task/042-before)

- [042 Task 01 (Open)](/task/042-task-01)

- [042 Task 03 (Open)](/task/042-task-03)

- [042 Task 04 (Open)](/task/042-task-04)

- [042 Task 05 (Open)](/task/042-task-05)

- [042 Task 06 (Open)](/task/042-task-06)

- [042 Task 07 (Open)](/task/042-task-07)

- [042 Task 08 (Open)](/task/042-task-08)

- [042 Task 09 (Open)](/task/042-task-09)

- [042 Task 10 (Open)](/task/042-task-10)

- [042 Task 11 (Open)](/task/042-task-11)

- [042 Task 12 (Open)](/task/042-task-12)

- [042 Moved new 1 (Open)](/task/042-moved-new-1)

- [042 Task 02 (Open)](/task/042-task-02)

- [042 Task 13 (Open)](/task/042-task-13)

- [042 Task 14 (Open)](/task/042-task-14)

- [042 Task 15 (Open)](/task/042-task-15)

End of tasks.
`);
});

test("two existing then three newly created tasks to the bottom third from the top third; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 043

- 043 Task 01 (Open)
- 043 Task 02 (Open)
- 043 Task 03 (Open)
- 043 Task 04 (Open)
- 043 Task 05 (Open)
- 043 Task 06 (Open)
- 043 Task 07 (Open)
- 043 Task 08 (Open)
- 043 Task 09 (Open)
- 043 Task 10 (Open)
- 043 Task 11 (Open)
- 043 Task 12 (Open)
- 043 Task 13 (Open)
- 043 Task 14 (Open)
- 043 Task 15 (Open)
- 043 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 043](/task-collection/roadmap-043).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-043 --limit 850b >/dev/null
alpine update /task-collection/roadmap-043 \\
  --old '- [043 Task 01 (Open)](/task/043-task-01)

- [043 Task 02 (Open)](/task/043-task-02)

- [043 Task 03 (Open)](/task/043-task-03)

- [043 Task 04 (Open)](/task/043-task-04)

- [043 Task 05 (Open)](/task/043-task-05)

- [043 Task 06 (Open)](/task/043-task-06)

- [043 Task 07 (Open)](/task/043-task-07)

- [043 Task 08 (Open)](/task/043-task-08)

- [043 Task 09 (Open)](/task/043-task-09)

- [043 Task 10 (Open)](/task/043-task-10)

- [043 Task 11 (Open)](/task/043-task-11)

- [043 Task 12 (Open)](/task/043-task-12)

- [043 Task 13 (Open)](/task/043-task-13)

- [043 Task 14 (Open)](/task/043-task-14)

- [043 Task 15 (Open)](/task/043-task-15)' \\
  --new '- [043 Task 01 (Open)](/task/043-task-01)

- [043 Task 04 (Open)](/task/043-task-04)

- [043 Task 05 (Open)](/task/043-task-05)

- [043 Task 06 (Open)](/task/043-task-06)

- [043 Task 07 (Open)](/task/043-task-07)

- [043 Task 08 (Open)](/task/043-task-08)

- [043 Task 09 (Open)](/task/043-task-09)

- [043 Task 10 (Open)](/task/043-task-10)

- [043 Task 11 (Open)](/task/043-task-11)

- [043 Task 12 (Open)](/task/043-task-12)

- [043 Task 02 (Open)](/task/043-task-02)

- [043 Task 03 (Open)](/task/043-task-03)

- 043 Moved new 1 (Open)

- 043 Moved new 2 (Open)

- 043 Moved new 3 (Open)

- [043 Task 13 (Open)](/task/043-task-13)

- [043 Task 14 (Open)](/task/043-task-14)

- [043 Task 15 (Open)](/task/043-task-15)'
alpine read /task-collection/roadmap-043 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 043

- [043 Task 01 (Open)](/task/043-task-01)

- [043 Task 04 (Open)](/task/043-task-04)

- [043 Task 05 (Open)](/task/043-task-05)

- [043 Task 06 (Open)](/task/043-task-06)

- [043 Task 07 (Open)](/task/043-task-07)

- [043 Task 08 (Open)](/task/043-task-08)

- [043 Task 09 (Open)](/task/043-task-09)

- [043 Task 10 (Open)](/task/043-task-10)

- [043 Task 11 (Open)](/task/043-task-11)

- [043 Task 12 (Open)](/task/043-task-12)

- [043 Task 02 (Open)](/task/043-task-02)

- [043 Task 03 (Open)](/task/043-task-03)

- [043 Moved new 1 (Open)](/task/043-moved-new-1)

- [043 Moved new 2 (Open)](/task/043-moved-new-2)

- [043 Moved new 3 (Open)](/task/043-moved-new-3)

- [043 Task 13 (Open)](/task/043-task-13)

- [043 Task 14 (Open)](/task/043-task-14)

- [043 Task 15 (Open)](/task/043-task-15)

- [043 After pagination guard with a deliberately long title (Open)](/task/043-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing and three newly created tasks interleaved to the bottom third from the top third; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 044

- 044 Before (Open)
- 044 Task 01 (Open)
- 044 Task 02 (Open)
- 044 Task 03 (Open)
- 044 Task 04 (Open)
- 044 Task 05 (Open)
- 044 Task 06 (Open)
- 044 Task 07 (Open)
- 044 Task 08 (Open)
- 044 Task 09 (Open)
- 044 Task 10 (Open)
- 044 Task 11 (Open)
- 044 Task 12 (Open)
- 044 Task 13 (Open)
- 044 Task 14 (Open)
- 044 Task 15 (Open)
- 044 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 044](/task-collection/roadmap-044).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-044 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [044 Task 01 (Open)](/task/044-task-01)

- [044 Task 02 (Open)](/task/044-task-02)

- [044 Task 03 (Open)](/task/044-task-03)

- [044 Task 04 (Open)](/task/044-task-04)

- [044 Task 05 (Open)](/task/044-task-05)

- [044 Task 06 (Open)](/task/044-task-06)

- [044 Task 07 (Open)](/task/044-task-07)

- [044 Task 08 (Open)](/task/044-task-08)

- [044 Task 09 (Open)](/task/044-task-09)

- [044 Task 10 (Open)](/task/044-task-10)

- [044 Task 11 (Open)](/task/044-task-11)

- [044 Task 12 (Open)](/task/044-task-12)

- [044 Task 13 (Open)](/task/044-task-13)

- [044 Task 14 (Open)](/task/044-task-14)

- [044 Task 15 (Open)](/task/044-task-15)' \\
  --new '- [044 Task 01 (Open)](/task/044-task-01)

- [044 Task 04 (Open)](/task/044-task-04)

- [044 Task 05 (Open)](/task/044-task-05)

- [044 Task 06 (Open)](/task/044-task-06)

- [044 Task 07 (Open)](/task/044-task-07)

- [044 Task 08 (Open)](/task/044-task-08)

- [044 Task 09 (Open)](/task/044-task-09)

- [044 Task 10 (Open)](/task/044-task-10)

- [044 Task 11 (Open)](/task/044-task-11)

- [044 Task 12 (Open)](/task/044-task-12)

- [044 Task 02 (Open)](/task/044-task-02)

- 044 Moved new 1 (Open)

- [044 Task 03 (Open)](/task/044-task-03)

- 044 Moved new 2 (Open)

- 044 Moved new 3 (Open)

- [044 Task 13 (Open)](/task/044-task-13)

- [044 Task 14 (Open)](/task/044-task-14)

- [044 Task 15 (Open)](/task/044-task-15)'
alpine read /task-collection/roadmap-044 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 044

- [044 Before (Open)](/task/044-before)

- [044 Task 01 (Open)](/task/044-task-01)

- [044 Task 04 (Open)](/task/044-task-04)

- [044 Task 05 (Open)](/task/044-task-05)

- [044 Task 06 (Open)](/task/044-task-06)

- [044 Task 07 (Open)](/task/044-task-07)

- [044 Task 08 (Open)](/task/044-task-08)

- [044 Task 09 (Open)](/task/044-task-09)

- [044 Task 10 (Open)](/task/044-task-10)

- [044 Task 11 (Open)](/task/044-task-11)

- [044 Task 12 (Open)](/task/044-task-12)

- [044 Task 02 (Open)](/task/044-task-02)

- [044 Moved new 1 (Open)](/task/044-moved-new-1)

- [044 Task 03 (Open)](/task/044-task-03)

- [044 Moved new 2 (Open)](/task/044-moved-new-2)

- [044 Moved new 3 (Open)](/task/044-moved-new-3)

- [044 Task 13 (Open)](/task/044-task-13)

- [044 Task 14 (Open)](/task/044-task-14)

- [044 Task 15 (Open)](/task/044-task-15)

- [044 After pagination guard with a deliberately long title (Open)](/task/044-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("three newly created then two existing tasks to the bottom third from the top third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 045

- 045 Before (Open)
- 045 Task 01 (Open)
- 045 Task 02 (Open)
- 045 Task 03 (Open)
- 045 Task 04 (Open)
- 045 Task 05 (Open)
- 045 Task 06 (Open)
- 045 Task 07 (Open)
- 045 Task 08 (Open)
- 045 Task 09 (Open)
- 045 Task 10 (Open)
- 045 Task 11 (Open)
- 045 Task 12 (Open)
- 045 Task 13 (Open)
- 045 Task 14 (Open)
- 045 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 045](/task-collection/roadmap-045).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-045 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [045 Task 01 (Open)](/task/045-task-01)

- [045 Task 02 (Open)](/task/045-task-02)

- [045 Task 03 (Open)](/task/045-task-03)

- [045 Task 04 (Open)](/task/045-task-04)

- [045 Task 05 (Open)](/task/045-task-05)

- [045 Task 06 (Open)](/task/045-task-06)

- [045 Task 07 (Open)](/task/045-task-07)

- [045 Task 08 (Open)](/task/045-task-08)

- [045 Task 09 (Open)](/task/045-task-09)

- [045 Task 10 (Open)](/task/045-task-10)

- [045 Task 11 (Open)](/task/045-task-11)

- [045 Task 12 (Open)](/task/045-task-12)

- [045 Task 13 (Open)](/task/045-task-13)

- [045 Task 14 (Open)](/task/045-task-14)

- [045 Task 15 (Open)](/task/045-task-15)' \\
  --new '- [045 Task 01 (Open)](/task/045-task-01)

- [045 Task 04 (Open)](/task/045-task-04)

- [045 Task 05 (Open)](/task/045-task-05)

- [045 Task 06 (Open)](/task/045-task-06)

- [045 Task 07 (Open)](/task/045-task-07)

- [045 Task 08 (Open)](/task/045-task-08)

- [045 Task 09 (Open)](/task/045-task-09)

- [045 Task 10 (Open)](/task/045-task-10)

- [045 Task 11 (Open)](/task/045-task-11)

- [045 Task 12 (Open)](/task/045-task-12)

- 045 Moved new 1 (Open)

- 045 Moved new 2 (Open)

- 045 Moved new 3 (Open)

- [045 Task 02 (Open)](/task/045-task-02)

- [045 Task 03 (Open)](/task/045-task-03)

- [045 Task 13 (Open)](/task/045-task-13)

- [045 Task 14 (Open)](/task/045-task-14)

- [045 Task 15 (Open)](/task/045-task-15)'
alpine read /task-collection/roadmap-045 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 045

- [045 Before (Open)](/task/045-before)

- [045 Task 01 (Open)](/task/045-task-01)

- [045 Task 04 (Open)](/task/045-task-04)

- [045 Task 05 (Open)](/task/045-task-05)

- [045 Task 06 (Open)](/task/045-task-06)

- [045 Task 07 (Open)](/task/045-task-07)

- [045 Task 08 (Open)](/task/045-task-08)

- [045 Task 09 (Open)](/task/045-task-09)

- [045 Task 10 (Open)](/task/045-task-10)

- [045 Task 11 (Open)](/task/045-task-11)

- [045 Task 12 (Open)](/task/045-task-12)

- [045 Moved new 1 (Open)](/task/045-moved-new-1)

- [045 Moved new 2 (Open)](/task/045-moved-new-2)

- [045 Moved new 3 (Open)](/task/045-moved-new-3)

- [045 Task 02 (Open)](/task/045-task-02)

- [045 Task 03 (Open)](/task/045-task-03)

- [045 Task 13 (Open)](/task/045-task-13)

- [045 Task 14 (Open)](/task/045-task-14)

- [045 Task 15 (Open)](/task/045-task-15)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 046

## Subtasks

- 046 Task 01 (Open)
- 046 Task 02 (Open)
- 046 Task 03 (Open)
- 046 Task 04 (Open)
- 046 Task 05 (Open)
- 046 Task 06 (Open)
- 046 Task 07 (Open)
- 046 Task 08 (Open)
- 046 Task 09 (Open)
- 046 Task 10 (Open)
- 046 Task 11 (Open)
- 046 Task 12 (Open)
- 046 Task 13 (Open)
- 046 Task 14 (Open)
- 046 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 046](/task/parent-046).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-046 --limit 100kb >/dev/null
alpine update /task/parent-046 \\
  --old '- [046 Task 01 (Open)](/task/046-task-01)

- [046 Task 02 (Open)](/task/046-task-02)

- [046 Task 03 (Open)](/task/046-task-03)

- [046 Task 04 (Open)](/task/046-task-04)

- [046 Task 05 (Open)](/task/046-task-05)

- [046 Task 06 (Open)](/task/046-task-06)

- [046 Task 07 (Open)](/task/046-task-07)

- [046 Task 08 (Open)](/task/046-task-08)

- [046 Task 09 (Open)](/task/046-task-09)

- [046 Task 10 (Open)](/task/046-task-10)

- [046 Task 11 (Open)](/task/046-task-11)

- [046 Task 12 (Open)](/task/046-task-12)

- [046 Task 13 (Open)](/task/046-task-13)

- [046 Task 14 (Open)](/task/046-task-14)

- [046 Task 15 (Open)](/task/046-task-15)' \\
  --new '- [046 Task 01 (Open)](/task/046-task-01)

- [046 Task 02 (Open)](/task/046-task-02)

- [046 Task 03 (Open)](/task/046-task-03)

- [046 Task 10 (Open)](/task/046-task-10)

- [046 Task 04 (Open)](/task/046-task-04)

- [046 Task 05 (Open)](/task/046-task-05)

- [046 Task 06 (Open)](/task/046-task-06)

- [046 Task 07 (Open)](/task/046-task-07)

- [046 Task 08 (Open)](/task/046-task-08)

- [046 Task 09 (Open)](/task/046-task-09)

- [046 Task 11 (Open)](/task/046-task-11)

- [046 Task 12 (Open)](/task/046-task-12)

- [046 Task 13 (Open)](/task/046-task-13)

- [046 Task 14 (Open)](/task/046-task-14)

- [046 Task 15 (Open)](/task/046-task-15)'
alpine read /task/parent-046 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 046

- Status: Open

## Subtasks

- [046 Task 01 (Open)](/task/046-task-01)

- [046 Task 02 (Open)](/task/046-task-02)

- [046 Task 03 (Open)](/task/046-task-03)

- [046 Task 10 (Open)](/task/046-task-10)

- [046 Task 04 (Open)](/task/046-task-04)

- [046 Task 05 (Open)](/task/046-task-05)

- [046 Task 06 (Open)](/task/046-task-06)

- [046 Task 07 (Open)](/task/046-task-07)

- [046 Task 08 (Open)](/task/046-task-08)

- [046 Task 09 (Open)](/task/046-task-09)

- [046 Task 11 (Open)](/task/046-task-11)

- [046 Task 12 (Open)](/task/046-task-12)

- [046 Task 13 (Open)](/task/046-task-13)

- [046 Task 14 (Open)](/task/046-task-14)

- [046 Task 15 (Open)](/task/046-task-15)
`);
});

test("two adjacent existing tasks to the top third from the bottom third; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 047

## Subtasks

- 047 Task 01 (Open)
- 047 Task 02 (Open)
- 047 Task 03 (Open)
- 047 Task 04 (Open)
- 047 Task 05 (Open)
- 047 Task 06 (Open)
- 047 Task 07 (Open)
- 047 Task 08 (Open)
- 047 Task 09 (Open)
- 047 Task 10 (Open)
- 047 Task 11 (Open)
- 047 Task 12 (Open)
- 047 Task 13 (Open)
- 047 Task 14 (Open)
- 047 Task 15 (Open)
- 047 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 047](/task/parent-047).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-047/subtasks --limit 850b >/dev/null
alpine update /task/parent-047/subtasks \\
  --old '- [047 Task 01 (Open)](/task/047-task-01)

- [047 Task 02 (Open)](/task/047-task-02)

- [047 Task 03 (Open)](/task/047-task-03)

- [047 Task 04 (Open)](/task/047-task-04)

- [047 Task 05 (Open)](/task/047-task-05)

- [047 Task 06 (Open)](/task/047-task-06)

- [047 Task 07 (Open)](/task/047-task-07)

- [047 Task 08 (Open)](/task/047-task-08)

- [047 Task 09 (Open)](/task/047-task-09)

- [047 Task 10 (Open)](/task/047-task-10)

- [047 Task 11 (Open)](/task/047-task-11)

- [047 Task 12 (Open)](/task/047-task-12)

- [047 Task 13 (Open)](/task/047-task-13)

- [047 Task 14 (Open)](/task/047-task-14)

- [047 Task 15 (Open)](/task/047-task-15)' \\
  --new '- [047 Task 01 (Open)](/task/047-task-01)

- [047 Task 02 (Open)](/task/047-task-02)

- [047 Task 03 (Open)](/task/047-task-03)

- [047 Task 10 (Open)](/task/047-task-10)

- [047 Task 11 (Open)](/task/047-task-11)

- [047 Task 04 (Open)](/task/047-task-04)

- [047 Task 05 (Open)](/task/047-task-05)

- [047 Task 06 (Open)](/task/047-task-06)

- [047 Task 07 (Open)](/task/047-task-07)

- [047 Task 08 (Open)](/task/047-task-08)

- [047 Task 09 (Open)](/task/047-task-09)

- [047 Task 12 (Open)](/task/047-task-12)

- [047 Task 13 (Open)](/task/047-task-13)

- [047 Task 14 (Open)](/task/047-task-14)

- [047 Task 15 (Open)](/task/047-task-15)'
alpine read /task/parent-047/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 047 (Open)](/task/parent-047).

- [047 Task 01 (Open)](/task/047-task-01)

- [047 Task 02 (Open)](/task/047-task-02)

- [047 Task 03 (Open)](/task/047-task-03)

- [047 Task 10 (Open)](/task/047-task-10)

- [047 Task 11 (Open)](/task/047-task-11)

- [047 Task 04 (Open)](/task/047-task-04)

- [047 Task 05 (Open)](/task/047-task-05)

- [047 Task 06 (Open)](/task/047-task-06)

- [047 Task 07 (Open)](/task/047-task-07)

- [047 Task 08 (Open)](/task/047-task-08)

- [047 Task 09 (Open)](/task/047-task-09)

- [047 Task 12 (Open)](/task/047-task-12)

- [047 Task 13 (Open)](/task/047-task-13)

- [047 Task 14 (Open)](/task/047-task-14)

- [047 Task 15 (Open)](/task/047-task-15)

- [047 After pagination guard with a deliberately long title (Open)](/task/047-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two non-adjacent existing tasks to the top third from the bottom third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 048

## Subtasks

- 048 Before (Open)
- 048 Task 01 (Open)
- 048 Task 02 (Open)
- 048 Task 03 (Open)
- 048 Task 04 (Open)
- 048 Task 05 (Open)
- 048 Task 06 (Open)
- 048 Task 07 (Open)
- 048 Task 08 (Open)
- 048 Task 09 (Open)
- 048 Task 10 (Open)
- 048 Task 11 (Open)
- 048 Task 12 (Open)
- 048 Task 13 (Open)
- 048 Task 14 (Open)
- 048 Task 15 (Open)
- 048 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 048](/task/parent-048).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-048/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [048 Task 01 (Open)](/task/048-task-01)

- [048 Task 02 (Open)](/task/048-task-02)

- [048 Task 03 (Open)](/task/048-task-03)

- [048 Task 04 (Open)](/task/048-task-04)

- [048 Task 05 (Open)](/task/048-task-05)

- [048 Task 06 (Open)](/task/048-task-06)

- [048 Task 07 (Open)](/task/048-task-07)

- [048 Task 08 (Open)](/task/048-task-08)

- [048 Task 09 (Open)](/task/048-task-09)

- [048 Task 10 (Open)](/task/048-task-10)

- [048 Task 11 (Open)](/task/048-task-11)

- [048 Task 12 (Open)](/task/048-task-12)

- [048 Task 13 (Open)](/task/048-task-13)

- [048 Task 14 (Open)](/task/048-task-14)

- [048 Task 15 (Open)](/task/048-task-15)' \\
  --new '- [048 Task 01 (Open)](/task/048-task-01)

- [048 Task 02 (Open)](/task/048-task-02)

- [048 Task 03 (Open)](/task/048-task-03)

- [048 Task 10 (Open)](/task/048-task-10)

- [048 Task 13 (Open)](/task/048-task-13)

- [048 Task 04 (Open)](/task/048-task-04)

- [048 Task 05 (Open)](/task/048-task-05)

- [048 Task 06 (Open)](/task/048-task-06)

- [048 Task 07 (Open)](/task/048-task-07)

- [048 Task 08 (Open)](/task/048-task-08)

- [048 Task 09 (Open)](/task/048-task-09)

- [048 Task 11 (Open)](/task/048-task-11)

- [048 Task 12 (Open)](/task/048-task-12)

- [048 Task 14 (Open)](/task/048-task-14)

- [048 Task 15 (Open)](/task/048-task-15)'
alpine read /task/parent-048/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 048 (Open)](/task/parent-048).

- [048 Before (Open)](/task/048-before)

- [048 Task 01 (Open)](/task/048-task-01)

- [048 Task 02 (Open)](/task/048-task-02)

- [048 Task 03 (Open)](/task/048-task-03)

- [048 Task 10 (Open)](/task/048-task-10)

- [048 Task 13 (Open)](/task/048-task-13)

- [048 Task 04 (Open)](/task/048-task-04)

- [048 Task 05 (Open)](/task/048-task-05)

- [048 Task 06 (Open)](/task/048-task-06)

- [048 Task 07 (Open)](/task/048-task-07)

- [048 Task 08 (Open)](/task/048-task-08)

- [048 Task 09 (Open)](/task/048-task-09)

- [048 Task 11 (Open)](/task/048-task-11)

- [048 Task 12 (Open)](/task/048-task-12)

- [048 Task 14 (Open)](/task/048-task-14)

- [048 Task 15 (Open)](/task/048-task-15)

- [048 After pagination guard with a deliberately long title (Open)](/task/048-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five existing tasks to the top third from the bottom third; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 049

## Subtasks

- 049 Before (Open)
- 049 Task 01 (Open)
- 049 Task 02 (Open)
- 049 Task 03 (Open)
- 049 Task 04 (Open)
- 049 Task 05 (Open)
- 049 Task 06 (Open)
- 049 Task 07 (Open)
- 049 Task 08 (Open)
- 049 Task 09 (Open)
- 049 Task 10 (Open)
- 049 Task 11 (Open)
- 049 Task 12 (Open)
- 049 Task 13 (Open)
- 049 Task 14 (Open)
- 049 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 049](/task/parent-049).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-049/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [049 Task 01 (Open)](/task/049-task-01)

- [049 Task 02 (Open)](/task/049-task-02)

- [049 Task 03 (Open)](/task/049-task-03)

- [049 Task 04 (Open)](/task/049-task-04)

- [049 Task 05 (Open)](/task/049-task-05)

- [049 Task 06 (Open)](/task/049-task-06)

- [049 Task 07 (Open)](/task/049-task-07)

- [049 Task 08 (Open)](/task/049-task-08)

- [049 Task 09 (Open)](/task/049-task-09)

- [049 Task 10 (Open)](/task/049-task-10)

- [049 Task 11 (Open)](/task/049-task-11)

- [049 Task 12 (Open)](/task/049-task-12)

- [049 Task 13 (Open)](/task/049-task-13)

- [049 Task 14 (Open)](/task/049-task-14)

- [049 Task 15 (Open)](/task/049-task-15)' \\
  --new '- [049 Task 01 (Open)](/task/049-task-01)

- [049 Task 02 (Open)](/task/049-task-02)

- [049 Task 03 (Open)](/task/049-task-03)

- [049 Task 10 (Open)](/task/049-task-10)

- [049 Task 11 (Open)](/task/049-task-11)

- [049 Task 12 (Open)](/task/049-task-12)

- [049 Task 13 (Open)](/task/049-task-13)

- [049 Task 14 (Open)](/task/049-task-14)

- [049 Task 04 (Open)](/task/049-task-04)

- [049 Task 05 (Open)](/task/049-task-05)

- [049 Task 06 (Open)](/task/049-task-06)

- [049 Task 07 (Open)](/task/049-task-07)

- [049 Task 08 (Open)](/task/049-task-08)

- [049 Task 09 (Open)](/task/049-task-09)

- [049 Task 15 (Open)](/task/049-task-15)'
alpine read /task/parent-049/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 049 (Open)](/task/parent-049).

- [049 Before (Open)](/task/049-before)

- [049 Task 01 (Open)](/task/049-task-01)

- [049 Task 02 (Open)](/task/049-task-02)

- [049 Task 03 (Open)](/task/049-task-03)

- [049 Task 10 (Open)](/task/049-task-10)

- [049 Task 11 (Open)](/task/049-task-11)

- [049 Task 12 (Open)](/task/049-task-12)

- [049 Task 13 (Open)](/task/049-task-13)

- [049 Task 14 (Open)](/task/049-task-14)

- [049 Task 04 (Open)](/task/049-task-04)

- [049 Task 05 (Open)](/task/049-task-05)

- [049 Task 06 (Open)](/task/049-task-06)

- [049 Task 07 (Open)](/task/049-task-07)

- [049 Task 08 (Open)](/task/049-task-08)

- [049 Task 09 (Open)](/task/049-task-09)

- [049 Task 15 (Open)](/task/049-task-15)

End of tasks.
`);
});

test("one newly created task to the top third from the bottom third; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 050

- 050 Task 01 (Open)
- 050 Task 02 (Open)
- 050 Task 03 (Open)
- 050 Task 04 (Open)
- 050 Task 05 (Open)
- 050 Task 06 (Open)
- 050 Task 07 (Open)
- 050 Task 08 (Open)
- 050 Task 09 (Open)
- 050 Task 10 (Open)
- 050 Task 11 (Open)
- 050 Task 12 (Open)
- 050 Task 13 (Open)
- 050 Task 14 (Open)
- 050 Task 15 (Open)
- 050 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 050](/task-collection/roadmap-050).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-050 --limit 850b >/dev/null
alpine update /task-collection/roadmap-050 \\
  --old '- [050 Task 01 (Open)](/task/050-task-01)

- [050 Task 02 (Open)](/task/050-task-02)

- [050 Task 03 (Open)](/task/050-task-03)

- [050 Task 04 (Open)](/task/050-task-04)

- [050 Task 05 (Open)](/task/050-task-05)

- [050 Task 06 (Open)](/task/050-task-06)

- [050 Task 07 (Open)](/task/050-task-07)

- [050 Task 08 (Open)](/task/050-task-08)

- [050 Task 09 (Open)](/task/050-task-09)

- [050 Task 10 (Open)](/task/050-task-10)

- [050 Task 11 (Open)](/task/050-task-11)

- [050 Task 12 (Open)](/task/050-task-12)

- [050 Task 13 (Open)](/task/050-task-13)

- [050 Task 14 (Open)](/task/050-task-14)

- [050 Task 15 (Open)](/task/050-task-15)' \\
  --new '- [050 Task 01 (Open)](/task/050-task-01)

- [050 Task 02 (Open)](/task/050-task-02)

- [050 Task 03 (Open)](/task/050-task-03)

- 050 Moved new 1 (Open)

- [050 Task 04 (Open)](/task/050-task-04)

- [050 Task 05 (Open)](/task/050-task-05)

- [050 Task 06 (Open)](/task/050-task-06)

- [050 Task 07 (Open)](/task/050-task-07)

- [050 Task 08 (Open)](/task/050-task-08)

- [050 Task 09 (Open)](/task/050-task-09)

- [050 Task 10 (Open)](/task/050-task-10)

- [050 Task 11 (Open)](/task/050-task-11)

- [050 Task 12 (Open)](/task/050-task-12)

- [050 Task 13 (Open)](/task/050-task-13)

- [050 Task 14 (Open)](/task/050-task-14)

- [050 Task 15 (Open)](/task/050-task-15)'
alpine read /task-collection/roadmap-050 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 050

- [050 Task 01 (Open)](/task/050-task-01)

- [050 Task 02 (Open)](/task/050-task-02)

- [050 Task 03 (Open)](/task/050-task-03)

- [050 Moved new 1 (Open)](/task/050-moved-new-1)

- [050 Task 04 (Open)](/task/050-task-04)

- [050 Task 05 (Open)](/task/050-task-05)

- [050 Task 06 (Open)](/task/050-task-06)

- [050 Task 07 (Open)](/task/050-task-07)

- [050 Task 08 (Open)](/task/050-task-08)

- [050 Task 09 (Open)](/task/050-task-09)

- [050 Task 10 (Open)](/task/050-task-10)

- [050 Task 11 (Open)](/task/050-task-11)

- [050 Task 12 (Open)](/task/050-task-12)

- [050 Task 13 (Open)](/task/050-task-13)

- [050 Task 14 (Open)](/task/050-task-14)

- [050 Task 15 (Open)](/task/050-task-15)

- [050 After pagination guard with a deliberately long title (Open)](/task/050-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two newly created tasks to the top third from the bottom third; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 051

- 051 Before (Open)
- 051 Task 01 (Open)
- 051 Task 02 (Open)
- 051 Task 03 (Open)
- 051 Task 04 (Open)
- 051 Task 05 (Open)
- 051 Task 06 (Open)
- 051 Task 07 (Open)
- 051 Task 08 (Open)
- 051 Task 09 (Open)
- 051 Task 10 (Open)
- 051 Task 11 (Open)
- 051 Task 12 (Open)
- 051 Task 13 (Open)
- 051 Task 14 (Open)
- 051 Task 15 (Open)
- 051 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 051](/task-collection/roadmap-051).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-051 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [051 Task 01 (Open)](/task/051-task-01)

- [051 Task 02 (Open)](/task/051-task-02)

- [051 Task 03 (Open)](/task/051-task-03)

- [051 Task 04 (Open)](/task/051-task-04)

- [051 Task 05 (Open)](/task/051-task-05)

- [051 Task 06 (Open)](/task/051-task-06)

- [051 Task 07 (Open)](/task/051-task-07)

- [051 Task 08 (Open)](/task/051-task-08)

- [051 Task 09 (Open)](/task/051-task-09)

- [051 Task 10 (Open)](/task/051-task-10)

- [051 Task 11 (Open)](/task/051-task-11)

- [051 Task 12 (Open)](/task/051-task-12)

- [051 Task 13 (Open)](/task/051-task-13)

- [051 Task 14 (Open)](/task/051-task-14)

- [051 Task 15 (Open)](/task/051-task-15)' \\
  --new '- [051 Task 01 (Open)](/task/051-task-01)

- [051 Task 02 (Open)](/task/051-task-02)

- [051 Task 03 (Open)](/task/051-task-03)

- 051 Moved new 1 (Open)

- 051 Moved new 2 (Open)

- [051 Task 04 (Open)](/task/051-task-04)

- [051 Task 05 (Open)](/task/051-task-05)

- [051 Task 06 (Open)](/task/051-task-06)

- [051 Task 07 (Open)](/task/051-task-07)

- [051 Task 08 (Open)](/task/051-task-08)

- [051 Task 09 (Open)](/task/051-task-09)

- [051 Task 10 (Open)](/task/051-task-10)

- [051 Task 11 (Open)](/task/051-task-11)

- [051 Task 12 (Open)](/task/051-task-12)

- [051 Task 13 (Open)](/task/051-task-13)

- [051 Task 14 (Open)](/task/051-task-14)

- [051 Task 15 (Open)](/task/051-task-15)'
alpine read /task-collection/roadmap-051 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 051

- [051 Before (Open)](/task/051-before)

- [051 Task 01 (Open)](/task/051-task-01)

- [051 Task 02 (Open)](/task/051-task-02)

- [051 Task 03 (Open)](/task/051-task-03)

- [051 Moved new 1 (Open)](/task/051-moved-new-1)

- [051 Moved new 2 (Open)](/task/051-moved-new-2)

- [051 Task 04 (Open)](/task/051-task-04)

- [051 Task 05 (Open)](/task/051-task-05)

- [051 Task 06 (Open)](/task/051-task-06)

- [051 Task 07 (Open)](/task/051-task-07)

- [051 Task 08 (Open)](/task/051-task-08)

- [051 Task 09 (Open)](/task/051-task-09)

- [051 Task 10 (Open)](/task/051-task-10)

- [051 Task 11 (Open)](/task/051-task-11)

- [051 Task 12 (Open)](/task/051-task-12)

- [051 Task 13 (Open)](/task/051-task-13)

- [051 Task 14 (Open)](/task/051-task-14)

- [051 Task 15 (Open)](/task/051-task-15)

- [051 After pagination guard with a deliberately long title (Open)](/task/051-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five newly created tasks to the top third from the bottom third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 052

- 052 Before (Open)
- 052 Task 01 (Open)
- 052 Task 02 (Open)
- 052 Task 03 (Open)
- 052 Task 04 (Open)
- 052 Task 05 (Open)
- 052 Task 06 (Open)
- 052 Task 07 (Open)
- 052 Task 08 (Open)
- 052 Task 09 (Open)
- 052 Task 10 (Open)
- 052 Task 11 (Open)
- 052 Task 12 (Open)
- 052 Task 13 (Open)
- 052 Task 14 (Open)
- 052 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 052](/task-collection/roadmap-052).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-052 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [052 Task 01 (Open)](/task/052-task-01)

- [052 Task 02 (Open)](/task/052-task-02)

- [052 Task 03 (Open)](/task/052-task-03)

- [052 Task 04 (Open)](/task/052-task-04)

- [052 Task 05 (Open)](/task/052-task-05)

- [052 Task 06 (Open)](/task/052-task-06)

- [052 Task 07 (Open)](/task/052-task-07)

- [052 Task 08 (Open)](/task/052-task-08)

- [052 Task 09 (Open)](/task/052-task-09)

- [052 Task 10 (Open)](/task/052-task-10)

- [052 Task 11 (Open)](/task/052-task-11)

- [052 Task 12 (Open)](/task/052-task-12)

- [052 Task 13 (Open)](/task/052-task-13)

- [052 Task 14 (Open)](/task/052-task-14)

- [052 Task 15 (Open)](/task/052-task-15)' \\
  --new '- [052 Task 01 (Open)](/task/052-task-01)

- [052 Task 02 (Open)](/task/052-task-02)

- [052 Task 03 (Open)](/task/052-task-03)

- 052 Moved new 1 (Open)

- 052 Moved new 2 (Open)

- 052 Moved new 3 (Open)

- 052 Moved new 4 (Open)

- 052 Moved new 5 (Open)

- [052 Task 04 (Open)](/task/052-task-04)

- [052 Task 05 (Open)](/task/052-task-05)

- [052 Task 06 (Open)](/task/052-task-06)

- [052 Task 07 (Open)](/task/052-task-07)

- [052 Task 08 (Open)](/task/052-task-08)

- [052 Task 09 (Open)](/task/052-task-09)

- [052 Task 10 (Open)](/task/052-task-10)

- [052 Task 11 (Open)](/task/052-task-11)

- [052 Task 12 (Open)](/task/052-task-12)

- [052 Task 13 (Open)](/task/052-task-13)

- [052 Task 14 (Open)](/task/052-task-14)

- [052 Task 15 (Open)](/task/052-task-15)'
alpine read /task-collection/roadmap-052 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 052

- [052 Before (Open)](/task/052-before)

- [052 Task 01 (Open)](/task/052-task-01)

- [052 Task 02 (Open)](/task/052-task-02)

- [052 Task 03 (Open)](/task/052-task-03)

- [052 Moved new 1 (Open)](/task/052-moved-new-1)

- [052 Moved new 2 (Open)](/task/052-moved-new-2)

- [052 Moved new 3 (Open)](/task/052-moved-new-3)

- [052 Moved new 4 (Open)](/task/052-moved-new-4)

- [052 Moved new 5 (Open)](/task/052-moved-new-5)

- [052 Task 04 (Open)](/task/052-task-04)

- [052 Task 05 (Open)](/task/052-task-05)

- [052 Task 06 (Open)](/task/052-task-06)

- [052 Task 07 (Open)](/task/052-task-07)

- [052 Task 08 (Open)](/task/052-task-08)

- [052 Task 09 (Open)](/task/052-task-09)

- [052 Task 10 (Open)](/task/052-task-10)

- [052 Task 11 (Open)](/task/052-task-11)

- [052 Task 12 (Open)](/task/052-task-12)

- [052 Task 13 (Open)](/task/052-task-13)

- [052 Task 14 (Open)](/task/052-task-14)

- [052 Task 15 (Open)](/task/052-task-15)

End of tasks.
`);
});

test("one task created by the previous update to the top third from the bottom third; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 053

## Subtasks

- 053 Task 01 (Open)
- 053 Task 02 (Open)
- 053 Task 03 (Open)
- 053 Task 04 (Open)
- 053 Task 05 (Open)
- 053 Task 06 (Open)
- 053 Task 07 (Open)
- 053 Task 08 (Open)
- 053 Task 09 (Open)
- 053 Task 10 (Open)
- 053 Task 11 (Open)
- 053 Task 12 (Open)
- 053 Task 13 (Open)
- 053 Task 14 (Open)
- 053 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 053](/task/parent-053).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-053 --limit 100kb >/dev/null
alpine update /task/parent-053 \\
  --old '- [053 Task 01 (Open)](/task/053-task-01)

- [053 Task 02 (Open)](/task/053-task-02)

- [053 Task 03 (Open)](/task/053-task-03)

- [053 Task 04 (Open)](/task/053-task-04)

- [053 Task 05 (Open)](/task/053-task-05)

- [053 Task 06 (Open)](/task/053-task-06)

- [053 Task 07 (Open)](/task/053-task-07)

- [053 Task 08 (Open)](/task/053-task-08)

- [053 Task 09 (Open)](/task/053-task-09)

- [053 Task 10 (Open)](/task/053-task-10)

- [053 Task 11 (Open)](/task/053-task-11)

- [053 Task 12 (Open)](/task/053-task-12)

- [053 Task 13 (Open)](/task/053-task-13)

- [053 Task 14 (Open)](/task/053-task-14)

- [053 Task 15 (Open)](/task/053-task-15)' \\
  --new '- [053 Task 01 (Open)](/task/053-task-01)

- [053 Task 02 (Open)](/task/053-task-02)

- [053 Task 03 (Open)](/task/053-task-03)

- [053 Task 04 (Open)](/task/053-task-04)

- [053 Task 05 (Open)](/task/053-task-05)

- [053 Task 06 (Open)](/task/053-task-06)

- [053 Task 07 (Open)](/task/053-task-07)

- [053 Task 08 (Open)](/task/053-task-08)

- [053 Task 09 (Open)](/task/053-task-09)

- [053 Task 10 (Open)](/task/053-task-10)

- 053 Moved previous 1 (Open)

- [053 Task 11 (Open)](/task/053-task-11)

- [053 Task 12 (Open)](/task/053-task-12)

- [053 Task 13 (Open)](/task/053-task-13)

- [053 Task 14 (Open)](/task/053-task-14)

- [053 Task 15 (Open)](/task/053-task-15)'
alpine update /task/parent-053 \\
  --old '- [053 Task 01 (Open)](/task/053-task-01)

- [053 Task 02 (Open)](/task/053-task-02)

- [053 Task 03 (Open)](/task/053-task-03)

- [053 Task 04 (Open)](/task/053-task-04)

- [053 Task 05 (Open)](/task/053-task-05)

- [053 Task 06 (Open)](/task/053-task-06)

- [053 Task 07 (Open)](/task/053-task-07)

- [053 Task 08 (Open)](/task/053-task-08)

- [053 Task 09 (Open)](/task/053-task-09)

- [053 Task 10 (Open)](/task/053-task-10)

- 053 Moved previous 1 (Open)

- [053 Task 11 (Open)](/task/053-task-11)

- [053 Task 12 (Open)](/task/053-task-12)

- [053 Task 13 (Open)](/task/053-task-13)

- [053 Task 14 (Open)](/task/053-task-14)

- [053 Task 15 (Open)](/task/053-task-15)' \\
  --new '- [053 Task 01 (Open)](/task/053-task-01)

- [053 Task 02 (Open)](/task/053-task-02)

- [053 Task 03 (Open)](/task/053-task-03)

- 053 Moved previous 1 (Open)

- [053 Task 04 (Open)](/task/053-task-04)

- [053 Task 05 (Open)](/task/053-task-05)

- [053 Task 06 (Open)](/task/053-task-06)

- [053 Task 07 (Open)](/task/053-task-07)

- [053 Task 08 (Open)](/task/053-task-08)

- [053 Task 09 (Open)](/task/053-task-09)

- [053 Task 10 (Open)](/task/053-task-10)

- [053 Task 11 (Open)](/task/053-task-11)

- [053 Task 12 (Open)](/task/053-task-12)

- [053 Task 13 (Open)](/task/053-task-13)

- [053 Task 14 (Open)](/task/053-task-14)

- [053 Task 15 (Open)](/task/053-task-15)'
alpine read /task/parent-053 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 053

- Status: Open

## Subtasks

- [053 Task 01 (Open)](/task/053-task-01)

- [053 Task 02 (Open)](/task/053-task-02)

- [053 Task 03 (Open)](/task/053-task-03)

- [053 Moved previous 1 (Open)](/task/053-moved-previous-1)

- [053 Task 04 (Open)](/task/053-task-04)

- [053 Task 05 (Open)](/task/053-task-05)

- [053 Task 06 (Open)](/task/053-task-06)

- [053 Task 07 (Open)](/task/053-task-07)

- [053 Task 08 (Open)](/task/053-task-08)

- [053 Task 09 (Open)](/task/053-task-09)

- [053 Task 10 (Open)](/task/053-task-10)

- [053 Task 11 (Open)](/task/053-task-11)

- [053 Task 12 (Open)](/task/053-task-12)

- [053 Task 13 (Open)](/task/053-task-13)

- [053 Task 14 (Open)](/task/053-task-14)

- [053 Task 15 (Open)](/task/053-task-15)
`);
});

test("two tasks created by the previous update to the top third from the bottom third; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 054

## Subtasks

- 054 Task 01 (Open)
- 054 Task 02 (Open)
- 054 Task 03 (Open)
- 054 Task 04 (Open)
- 054 Task 05 (Open)
- 054 Task 06 (Open)
- 054 Task 07 (Open)
- 054 Task 08 (Open)
- 054 Task 09 (Open)
- 054 Task 10 (Open)
- 054 Task 11 (Open)
- 054 Task 12 (Open)
- 054 Task 13 (Open)
- 054 Task 14 (Open)
- 054 Task 15 (Open)
- 054 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 054](/task/parent-054).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-054/subtasks --limit 850b >/dev/null
alpine update /task/parent-054/subtasks \\
  --old '- [054 Task 01 (Open)](/task/054-task-01)

- [054 Task 02 (Open)](/task/054-task-02)

- [054 Task 03 (Open)](/task/054-task-03)

- [054 Task 04 (Open)](/task/054-task-04)

- [054 Task 05 (Open)](/task/054-task-05)

- [054 Task 06 (Open)](/task/054-task-06)

- [054 Task 07 (Open)](/task/054-task-07)

- [054 Task 08 (Open)](/task/054-task-08)

- [054 Task 09 (Open)](/task/054-task-09)

- [054 Task 10 (Open)](/task/054-task-10)

- [054 Task 11 (Open)](/task/054-task-11)

- [054 Task 12 (Open)](/task/054-task-12)

- [054 Task 13 (Open)](/task/054-task-13)

- [054 Task 14 (Open)](/task/054-task-14)

- [054 Task 15 (Open)](/task/054-task-15)' \\
  --new '- [054 Task 01 (Open)](/task/054-task-01)

- [054 Task 02 (Open)](/task/054-task-02)

- [054 Task 03 (Open)](/task/054-task-03)

- [054 Task 04 (Open)](/task/054-task-04)

- [054 Task 05 (Open)](/task/054-task-05)

- [054 Task 06 (Open)](/task/054-task-06)

- [054 Task 07 (Open)](/task/054-task-07)

- [054 Task 08 (Open)](/task/054-task-08)

- [054 Task 09 (Open)](/task/054-task-09)

- [054 Task 10 (Open)](/task/054-task-10)

- 054 Moved previous 1 (Open)

- 054 Moved previous 2 (Open)

- [054 Task 11 (Open)](/task/054-task-11)

- [054 Task 12 (Open)](/task/054-task-12)

- [054 Task 13 (Open)](/task/054-task-13)

- [054 Task 14 (Open)](/task/054-task-14)

- [054 Task 15 (Open)](/task/054-task-15)'
alpine update /task/parent-054/subtasks \\
  --old '- [054 Task 01 (Open)](/task/054-task-01)

- [054 Task 02 (Open)](/task/054-task-02)

- [054 Task 03 (Open)](/task/054-task-03)

- [054 Task 04 (Open)](/task/054-task-04)

- [054 Task 05 (Open)](/task/054-task-05)

- [054 Task 06 (Open)](/task/054-task-06)

- [054 Task 07 (Open)](/task/054-task-07)

- [054 Task 08 (Open)](/task/054-task-08)

- [054 Task 09 (Open)](/task/054-task-09)

- [054 Task 10 (Open)](/task/054-task-10)

- 054 Moved previous 1 (Open)

- 054 Moved previous 2 (Open)

- [054 Task 11 (Open)](/task/054-task-11)

- [054 Task 12 (Open)](/task/054-task-12)

- [054 Task 13 (Open)](/task/054-task-13)

- [054 Task 14 (Open)](/task/054-task-14)

- [054 Task 15 (Open)](/task/054-task-15)' \\
  --new '- [054 Task 01 (Open)](/task/054-task-01)

- [054 Task 02 (Open)](/task/054-task-02)

- [054 Task 03 (Open)](/task/054-task-03)

- 054 Moved previous 1 (Open)

- 054 Moved previous 2 (Open)

- [054 Task 04 (Open)](/task/054-task-04)

- [054 Task 05 (Open)](/task/054-task-05)

- [054 Task 06 (Open)](/task/054-task-06)

- [054 Task 07 (Open)](/task/054-task-07)

- [054 Task 08 (Open)](/task/054-task-08)

- [054 Task 09 (Open)](/task/054-task-09)

- [054 Task 10 (Open)](/task/054-task-10)

- [054 Task 11 (Open)](/task/054-task-11)

- [054 Task 12 (Open)](/task/054-task-12)

- [054 Task 13 (Open)](/task/054-task-13)

- [054 Task 14 (Open)](/task/054-task-14)

- [054 Task 15 (Open)](/task/054-task-15)'
alpine read /task/parent-054/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 054 (Open)](/task/parent-054).

- [054 Task 01 (Open)](/task/054-task-01)

- [054 Task 02 (Open)](/task/054-task-02)

- [054 Task 03 (Open)](/task/054-task-03)

- [054 Moved previous 1 (Open)](/task/054-moved-previous-1)

- [054 Moved previous 2 (Open)](/task/054-moved-previous-2)

- [054 Task 04 (Open)](/task/054-task-04)

- [054 Task 05 (Open)](/task/054-task-05)

- [054 Task 06 (Open)](/task/054-task-06)

- [054 Task 07 (Open)](/task/054-task-07)

- [054 Task 08 (Open)](/task/054-task-08)

- [054 Task 09 (Open)](/task/054-task-09)

- [054 Task 10 (Open)](/task/054-task-10)

- [054 Task 11 (Open)](/task/054-task-11)

- [054 Task 12 (Open)](/task/054-task-12)

- [054 Task 13 (Open)](/task/054-task-13)

- [054 Task 14 (Open)](/task/054-task-14)

- [054 Task 15 (Open)](/task/054-task-15)

- [054 After pagination guard with a deliberately long title (Open)](/task/054-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("five tasks created by the previous update to the top third from the bottom third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 055

## Subtasks

- 055 Before (Open)
- 055 Task 01 (Open)
- 055 Task 02 (Open)
- 055 Task 03 (Open)
- 055 Task 04 (Open)
- 055 Task 05 (Open)
- 055 Task 06 (Open)
- 055 Task 07 (Open)
- 055 Task 08 (Open)
- 055 Task 09 (Open)
- 055 Task 10 (Open)
- 055 Task 11 (Open)
- 055 Task 12 (Open)
- 055 Task 13 (Open)
- 055 Task 14 (Open)
- 055 Task 15 (Open)
- 055 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 055](/task/parent-055).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-055/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [055 Task 01 (Open)](/task/055-task-01)

- [055 Task 02 (Open)](/task/055-task-02)

- [055 Task 03 (Open)](/task/055-task-03)

- [055 Task 04 (Open)](/task/055-task-04)

- [055 Task 05 (Open)](/task/055-task-05)

- [055 Task 06 (Open)](/task/055-task-06)

- [055 Task 07 (Open)](/task/055-task-07)

- [055 Task 08 (Open)](/task/055-task-08)

- [055 Task 09 (Open)](/task/055-task-09)

- [055 Task 10 (Open)](/task/055-task-10)

- [055 Task 11 (Open)](/task/055-task-11)

- [055 Task 12 (Open)](/task/055-task-12)

- [055 Task 13 (Open)](/task/055-task-13)

- [055 Task 14 (Open)](/task/055-task-14)

- [055 Task 15 (Open)](/task/055-task-15)' \\
  --new '- [055 Task 01 (Open)](/task/055-task-01)

- [055 Task 02 (Open)](/task/055-task-02)

- [055 Task 03 (Open)](/task/055-task-03)

- [055 Task 04 (Open)](/task/055-task-04)

- [055 Task 05 (Open)](/task/055-task-05)

- [055 Task 06 (Open)](/task/055-task-06)

- [055 Task 07 (Open)](/task/055-task-07)

- [055 Task 08 (Open)](/task/055-task-08)

- [055 Task 09 (Open)](/task/055-task-09)

- [055 Task 10 (Open)](/task/055-task-10)

- 055 Moved previous 1 (Open)

- 055 Moved previous 2 (Open)

- 055 Moved previous 3 (Open)

- 055 Moved previous 4 (Open)

- 055 Moved previous 5 (Open)

- [055 Task 11 (Open)](/task/055-task-11)

- [055 Task 12 (Open)](/task/055-task-12)

- [055 Task 13 (Open)](/task/055-task-13)

- [055 Task 14 (Open)](/task/055-task-14)

- [055 Task 15 (Open)](/task/055-task-15)'
alpine update $path \\
  --old '- [055 Task 01 (Open)](/task/055-task-01)

- [055 Task 02 (Open)](/task/055-task-02)

- [055 Task 03 (Open)](/task/055-task-03)

- [055 Task 04 (Open)](/task/055-task-04)

- [055 Task 05 (Open)](/task/055-task-05)

- [055 Task 06 (Open)](/task/055-task-06)

- [055 Task 07 (Open)](/task/055-task-07)

- [055 Task 08 (Open)](/task/055-task-08)

- [055 Task 09 (Open)](/task/055-task-09)

- [055 Task 10 (Open)](/task/055-task-10)

- 055 Moved previous 1 (Open)

- 055 Moved previous 2 (Open)

- 055 Moved previous 3 (Open)

- 055 Moved previous 4 (Open)

- 055 Moved previous 5 (Open)

- [055 Task 11 (Open)](/task/055-task-11)

- [055 Task 12 (Open)](/task/055-task-12)

- [055 Task 13 (Open)](/task/055-task-13)

- [055 Task 14 (Open)](/task/055-task-14)

- [055 Task 15 (Open)](/task/055-task-15)' \\
  --new '- [055 Task 01 (Open)](/task/055-task-01)

- [055 Task 02 (Open)](/task/055-task-02)

- [055 Task 03 (Open)](/task/055-task-03)

- 055 Moved previous 1 (Open)

- 055 Moved previous 2 (Open)

- 055 Moved previous 3 (Open)

- 055 Moved previous 4 (Open)

- 055 Moved previous 5 (Open)

- [055 Task 04 (Open)](/task/055-task-04)

- [055 Task 05 (Open)](/task/055-task-05)

- [055 Task 06 (Open)](/task/055-task-06)

- [055 Task 07 (Open)](/task/055-task-07)

- [055 Task 08 (Open)](/task/055-task-08)

- [055 Task 09 (Open)](/task/055-task-09)

- [055 Task 10 (Open)](/task/055-task-10)

- [055 Task 11 (Open)](/task/055-task-11)

- [055 Task 12 (Open)](/task/055-task-12)

- [055 Task 13 (Open)](/task/055-task-13)

- [055 Task 14 (Open)](/task/055-task-14)

- [055 Task 15 (Open)](/task/055-task-15)'
alpine read /task/parent-055/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 055 (Open)](/task/parent-055).

- [055 Before (Open)](/task/055-before)

- [055 Task 01 (Open)](/task/055-task-01)

- [055 Task 02 (Open)](/task/055-task-02)

- [055 Task 03 (Open)](/task/055-task-03)

- [055 Moved previous 1 (Open)](/task/055-moved-previous-1)

- [055 Moved previous 2 (Open)](/task/055-moved-previous-2)

- [055 Moved previous 3 (Open)](/task/055-moved-previous-3)

- [055 Moved previous 4 (Open)](/task/055-moved-previous-4)

- [055 Moved previous 5 (Open)](/task/055-moved-previous-5)

- [055 Task 04 (Open)](/task/055-task-04)

- [055 Task 05 (Open)](/task/055-task-05)

- [055 Task 06 (Open)](/task/055-task-06)

- [055 Task 07 (Open)](/task/055-task-07)

- [055 Task 08 (Open)](/task/055-task-08)

- [055 Task 09 (Open)](/task/055-task-09)

- [055 Task 10 (Open)](/task/055-task-10)

- [055 Task 11 (Open)](/task/055-task-11)

- [055 Task 12 (Open)](/task/055-task-12)

- [055 Task 13 (Open)](/task/055-task-13)

- [055 Task 14 (Open)](/task/055-task-14)

- [055 Task 15 (Open)](/task/055-task-15)

- [055 After pagination guard with a deliberately long title (Open)](/task/055-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing then one newly created task to the top third from the bottom third; task subtasks page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 056

## Subtasks

- 056 Before (Open)
- 056 Task 01 (Open)
- 056 Task 02 (Open)
- 056 Task 03 (Open)
- 056 Task 04 (Open)
- 056 Task 05 (Open)
- 056 Task 06 (Open)
- 056 Task 07 (Open)
- 056 Task 08 (Open)
- 056 Task 09 (Open)
- 056 Task 10 (Open)
- 056 Task 11 (Open)
- 056 Task 12 (Open)
- 056 Task 13 (Open)
- 056 Task 14 (Open)
- 056 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 056](/task/parent-056).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-056/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [056 Task 01 (Open)](/task/056-task-01)

- [056 Task 02 (Open)](/task/056-task-02)

- [056 Task 03 (Open)](/task/056-task-03)

- [056 Task 04 (Open)](/task/056-task-04)

- [056 Task 05 (Open)](/task/056-task-05)

- [056 Task 06 (Open)](/task/056-task-06)

- [056 Task 07 (Open)](/task/056-task-07)

- [056 Task 08 (Open)](/task/056-task-08)

- [056 Task 09 (Open)](/task/056-task-09)

- [056 Task 10 (Open)](/task/056-task-10)

- [056 Task 11 (Open)](/task/056-task-11)

- [056 Task 12 (Open)](/task/056-task-12)

- [056 Task 13 (Open)](/task/056-task-13)

- [056 Task 14 (Open)](/task/056-task-14)

- [056 Task 15 (Open)](/task/056-task-15)' \\
  --new '- [056 Task 01 (Open)](/task/056-task-01)

- [056 Task 02 (Open)](/task/056-task-02)

- [056 Task 03 (Open)](/task/056-task-03)

- [056 Task 10 (Open)](/task/056-task-10)

- 056 Moved new 1 (Open)

- [056 Task 04 (Open)](/task/056-task-04)

- [056 Task 05 (Open)](/task/056-task-05)

- [056 Task 06 (Open)](/task/056-task-06)

- [056 Task 07 (Open)](/task/056-task-07)

- [056 Task 08 (Open)](/task/056-task-08)

- [056 Task 09 (Open)](/task/056-task-09)

- [056 Task 11 (Open)](/task/056-task-11)

- [056 Task 12 (Open)](/task/056-task-12)

- [056 Task 13 (Open)](/task/056-task-13)

- [056 Task 14 (Open)](/task/056-task-14)

- [056 Task 15 (Open)](/task/056-task-15)'
alpine read /task/parent-056/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 056 (Open)](/task/parent-056).

- [056 Before (Open)](/task/056-before)

- [056 Task 01 (Open)](/task/056-task-01)

- [056 Task 02 (Open)](/task/056-task-02)

- [056 Task 03 (Open)](/task/056-task-03)

- [056 Task 10 (Open)](/task/056-task-10)

- [056 Moved new 1 (Open)](/task/056-moved-new-1)

- [056 Task 04 (Open)](/task/056-task-04)

- [056 Task 05 (Open)](/task/056-task-05)

- [056 Task 06 (Open)](/task/056-task-06)

- [056 Task 07 (Open)](/task/056-task-07)

- [056 Task 08 (Open)](/task/056-task-08)

- [056 Task 09 (Open)](/task/056-task-09)

- [056 Task 11 (Open)](/task/056-task-11)

- [056 Task 12 (Open)](/task/056-task-12)

- [056 Task 13 (Open)](/task/056-task-13)

- [056 Task 14 (Open)](/task/056-task-14)

- [056 Task 15 (Open)](/task/056-task-15)

End of tasks.
`);
});

test("one newly created then one existing task to the top third from the bottom third; task collection page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 057

- 057 Task 01 (Open)
- 057 Task 02 (Open)
- 057 Task 03 (Open)
- 057 Task 04 (Open)
- 057 Task 05 (Open)
- 057 Task 06 (Open)
- 057 Task 07 (Open)
- 057 Task 08 (Open)
- 057 Task 09 (Open)
- 057 Task 10 (Open)
- 057 Task 11 (Open)
- 057 Task 12 (Open)
- 057 Task 13 (Open)
- 057 Task 14 (Open)
- 057 Task 15 (Open)
- 057 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 057](/task-collection/roadmap-057).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-057 --limit 850b >/dev/null
alpine update /task-collection/roadmap-057 \\
  --old '- [057 Task 01 (Open)](/task/057-task-01)

- [057 Task 02 (Open)](/task/057-task-02)

- [057 Task 03 (Open)](/task/057-task-03)

- [057 Task 04 (Open)](/task/057-task-04)

- [057 Task 05 (Open)](/task/057-task-05)

- [057 Task 06 (Open)](/task/057-task-06)

- [057 Task 07 (Open)](/task/057-task-07)

- [057 Task 08 (Open)](/task/057-task-08)

- [057 Task 09 (Open)](/task/057-task-09)

- [057 Task 10 (Open)](/task/057-task-10)

- [057 Task 11 (Open)](/task/057-task-11)

- [057 Task 12 (Open)](/task/057-task-12)

- [057 Task 13 (Open)](/task/057-task-13)

- [057 Task 14 (Open)](/task/057-task-14)

- [057 Task 15 (Open)](/task/057-task-15)' \\
  --new '- [057 Task 01 (Open)](/task/057-task-01)

- [057 Task 02 (Open)](/task/057-task-02)

- [057 Task 03 (Open)](/task/057-task-03)

- 057 Moved new 1 (Open)

- [057 Task 10 (Open)](/task/057-task-10)

- [057 Task 04 (Open)](/task/057-task-04)

- [057 Task 05 (Open)](/task/057-task-05)

- [057 Task 06 (Open)](/task/057-task-06)

- [057 Task 07 (Open)](/task/057-task-07)

- [057 Task 08 (Open)](/task/057-task-08)

- [057 Task 09 (Open)](/task/057-task-09)

- [057 Task 11 (Open)](/task/057-task-11)

- [057 Task 12 (Open)](/task/057-task-12)

- [057 Task 13 (Open)](/task/057-task-13)

- [057 Task 14 (Open)](/task/057-task-14)

- [057 Task 15 (Open)](/task/057-task-15)'
alpine read /task-collection/roadmap-057 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 057

- [057 Task 01 (Open)](/task/057-task-01)

- [057 Task 02 (Open)](/task/057-task-02)

- [057 Task 03 (Open)](/task/057-task-03)

- [057 Moved new 1 (Open)](/task/057-moved-new-1)

- [057 Task 10 (Open)](/task/057-task-10)

- [057 Task 04 (Open)](/task/057-task-04)

- [057 Task 05 (Open)](/task/057-task-05)

- [057 Task 06 (Open)](/task/057-task-06)

- [057 Task 07 (Open)](/task/057-task-07)

- [057 Task 08 (Open)](/task/057-task-08)

- [057 Task 09 (Open)](/task/057-task-09)

- [057 Task 11 (Open)](/task/057-task-11)

- [057 Task 12 (Open)](/task/057-task-12)

- [057 Task 13 (Open)](/task/057-task-13)

- [057 Task 14 (Open)](/task/057-task-14)

- [057 Task 15 (Open)](/task/057-task-15)

- [057 After pagination guard with a deliberately long title (Open)](/task/057-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing then three newly created tasks to the top third from the bottom third; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 058

- 058 Before (Open)
- 058 Task 01 (Open)
- 058 Task 02 (Open)
- 058 Task 03 (Open)
- 058 Task 04 (Open)
- 058 Task 05 (Open)
- 058 Task 06 (Open)
- 058 Task 07 (Open)
- 058 Task 08 (Open)
- 058 Task 09 (Open)
- 058 Task 10 (Open)
- 058 Task 11 (Open)
- 058 Task 12 (Open)
- 058 Task 13 (Open)
- 058 Task 14 (Open)
- 058 Task 15 (Open)
- 058 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 058](/task-collection/roadmap-058).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-058 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [058 Task 01 (Open)](/task/058-task-01)

- [058 Task 02 (Open)](/task/058-task-02)

- [058 Task 03 (Open)](/task/058-task-03)

- [058 Task 04 (Open)](/task/058-task-04)

- [058 Task 05 (Open)](/task/058-task-05)

- [058 Task 06 (Open)](/task/058-task-06)

- [058 Task 07 (Open)](/task/058-task-07)

- [058 Task 08 (Open)](/task/058-task-08)

- [058 Task 09 (Open)](/task/058-task-09)

- [058 Task 10 (Open)](/task/058-task-10)

- [058 Task 11 (Open)](/task/058-task-11)

- [058 Task 12 (Open)](/task/058-task-12)

- [058 Task 13 (Open)](/task/058-task-13)

- [058 Task 14 (Open)](/task/058-task-14)

- [058 Task 15 (Open)](/task/058-task-15)' \\
  --new '- [058 Task 01 (Open)](/task/058-task-01)

- [058 Task 02 (Open)](/task/058-task-02)

- [058 Task 03 (Open)](/task/058-task-03)

- [058 Task 10 (Open)](/task/058-task-10)

- [058 Task 11 (Open)](/task/058-task-11)

- 058 Moved new 1 (Open)

- 058 Moved new 2 (Open)

- 058 Moved new 3 (Open)

- [058 Task 04 (Open)](/task/058-task-04)

- [058 Task 05 (Open)](/task/058-task-05)

- [058 Task 06 (Open)](/task/058-task-06)

- [058 Task 07 (Open)](/task/058-task-07)

- [058 Task 08 (Open)](/task/058-task-08)

- [058 Task 09 (Open)](/task/058-task-09)

- [058 Task 12 (Open)](/task/058-task-12)

- [058 Task 13 (Open)](/task/058-task-13)

- [058 Task 14 (Open)](/task/058-task-14)

- [058 Task 15 (Open)](/task/058-task-15)'
alpine read /task-collection/roadmap-058 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 058

- [058 Before (Open)](/task/058-before)

- [058 Task 01 (Open)](/task/058-task-01)

- [058 Task 02 (Open)](/task/058-task-02)

- [058 Task 03 (Open)](/task/058-task-03)

- [058 Task 10 (Open)](/task/058-task-10)

- [058 Task 11 (Open)](/task/058-task-11)

- [058 Moved new 1 (Open)](/task/058-moved-new-1)

- [058 Moved new 2 (Open)](/task/058-moved-new-2)

- [058 Moved new 3 (Open)](/task/058-moved-new-3)

- [058 Task 04 (Open)](/task/058-task-04)

- [058 Task 05 (Open)](/task/058-task-05)

- [058 Task 06 (Open)](/task/058-task-06)

- [058 Task 07 (Open)](/task/058-task-07)

- [058 Task 08 (Open)](/task/058-task-08)

- [058 Task 09 (Open)](/task/058-task-09)

- [058 Task 12 (Open)](/task/058-task-12)

- [058 Task 13 (Open)](/task/058-task-13)

- [058 Task 14 (Open)](/task/058-task-14)

- [058 Task 15 (Open)](/task/058-task-15)

- [058 After pagination guard with a deliberately long title (Open)](/task/058-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("two existing and three newly created tasks interleaved to the top third from the bottom third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 059

- 059 Before (Open)
- 059 Task 01 (Open)
- 059 Task 02 (Open)
- 059 Task 03 (Open)
- 059 Task 04 (Open)
- 059 Task 05 (Open)
- 059 Task 06 (Open)
- 059 Task 07 (Open)
- 059 Task 08 (Open)
- 059 Task 09 (Open)
- 059 Task 10 (Open)
- 059 Task 11 (Open)
- 059 Task 12 (Open)
- 059 Task 13 (Open)
- 059 Task 14 (Open)
- 059 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 059](/task-collection/roadmap-059).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-059 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [059 Task 01 (Open)](/task/059-task-01)

- [059 Task 02 (Open)](/task/059-task-02)

- [059 Task 03 (Open)](/task/059-task-03)

- [059 Task 04 (Open)](/task/059-task-04)

- [059 Task 05 (Open)](/task/059-task-05)

- [059 Task 06 (Open)](/task/059-task-06)

- [059 Task 07 (Open)](/task/059-task-07)

- [059 Task 08 (Open)](/task/059-task-08)

- [059 Task 09 (Open)](/task/059-task-09)

- [059 Task 10 (Open)](/task/059-task-10)

- [059 Task 11 (Open)](/task/059-task-11)

- [059 Task 12 (Open)](/task/059-task-12)

- [059 Task 13 (Open)](/task/059-task-13)

- [059 Task 14 (Open)](/task/059-task-14)

- [059 Task 15 (Open)](/task/059-task-15)' \\
  --new '- [059 Task 01 (Open)](/task/059-task-01)

- [059 Task 02 (Open)](/task/059-task-02)

- [059 Task 03 (Open)](/task/059-task-03)

- [059 Task 10 (Open)](/task/059-task-10)

- 059 Moved new 1 (Open)

- [059 Task 11 (Open)](/task/059-task-11)

- 059 Moved new 2 (Open)

- 059 Moved new 3 (Open)

- [059 Task 04 (Open)](/task/059-task-04)

- [059 Task 05 (Open)](/task/059-task-05)

- [059 Task 06 (Open)](/task/059-task-06)

- [059 Task 07 (Open)](/task/059-task-07)

- [059 Task 08 (Open)](/task/059-task-08)

- [059 Task 09 (Open)](/task/059-task-09)

- [059 Task 12 (Open)](/task/059-task-12)

- [059 Task 13 (Open)](/task/059-task-13)

- [059 Task 14 (Open)](/task/059-task-14)

- [059 Task 15 (Open)](/task/059-task-15)'
alpine read /task-collection/roadmap-059 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 059

- [059 Before (Open)](/task/059-before)

- [059 Task 01 (Open)](/task/059-task-01)

- [059 Task 02 (Open)](/task/059-task-02)

- [059 Task 03 (Open)](/task/059-task-03)

- [059 Task 10 (Open)](/task/059-task-10)

- [059 Moved new 1 (Open)](/task/059-moved-new-1)

- [059 Task 11 (Open)](/task/059-task-11)

- [059 Moved new 2 (Open)](/task/059-moved-new-2)

- [059 Moved new 3 (Open)](/task/059-moved-new-3)

- [059 Task 04 (Open)](/task/059-task-04)

- [059 Task 05 (Open)](/task/059-task-05)

- [059 Task 06 (Open)](/task/059-task-06)

- [059 Task 07 (Open)](/task/059-task-07)

- [059 Task 08 (Open)](/task/059-task-08)

- [059 Task 09 (Open)](/task/059-task-09)

- [059 Task 12 (Open)](/task/059-task-12)

- [059 Task 13 (Open)](/task/059-task-13)

- [059 Task 14 (Open)](/task/059-task-14)

- [059 Task 15 (Open)](/task/059-task-15)

End of tasks.
`);
});

test("three newly created then two existing tasks to the top third from the bottom third; task page subtasks list; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 060

## Subtasks

- 060 Task 01 (Open)
- 060 Task 02 (Open)
- 060 Task 03 (Open)
- 060 Task 04 (Open)
- 060 Task 05 (Open)
- 060 Task 06 (Open)
- 060 Task 07 (Open)
- 060 Task 08 (Open)
- 060 Task 09 (Open)
- 060 Task 10 (Open)
- 060 Task 11 (Open)
- 060 Task 12 (Open)
- 060 Task 13 (Open)
- 060 Task 14 (Open)
- 060 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 060](/task/parent-060).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-060 --limit 100kb >/dev/null
alpine update /task/parent-060 \\
  --old '- [060 Task 01 (Open)](/task/060-task-01)

- [060 Task 02 (Open)](/task/060-task-02)

- [060 Task 03 (Open)](/task/060-task-03)

- [060 Task 04 (Open)](/task/060-task-04)

- [060 Task 05 (Open)](/task/060-task-05)

- [060 Task 06 (Open)](/task/060-task-06)

- [060 Task 07 (Open)](/task/060-task-07)

- [060 Task 08 (Open)](/task/060-task-08)

- [060 Task 09 (Open)](/task/060-task-09)

- [060 Task 10 (Open)](/task/060-task-10)

- [060 Task 11 (Open)](/task/060-task-11)

- [060 Task 12 (Open)](/task/060-task-12)

- [060 Task 13 (Open)](/task/060-task-13)

- [060 Task 14 (Open)](/task/060-task-14)

- [060 Task 15 (Open)](/task/060-task-15)' \\
  --new '- [060 Task 01 (Open)](/task/060-task-01)

- [060 Task 02 (Open)](/task/060-task-02)

- [060 Task 03 (Open)](/task/060-task-03)

- 060 Moved new 1 (Open)

- 060 Moved new 2 (Open)

- 060 Moved new 3 (Open)

- [060 Task 10 (Open)](/task/060-task-10)

- [060 Task 11 (Open)](/task/060-task-11)

- [060 Task 04 (Open)](/task/060-task-04)

- [060 Task 05 (Open)](/task/060-task-05)

- [060 Task 06 (Open)](/task/060-task-06)

- [060 Task 07 (Open)](/task/060-task-07)

- [060 Task 08 (Open)](/task/060-task-08)

- [060 Task 09 (Open)](/task/060-task-09)

- [060 Task 12 (Open)](/task/060-task-12)

- [060 Task 13 (Open)](/task/060-task-13)

- [060 Task 14 (Open)](/task/060-task-14)

- [060 Task 15 (Open)](/task/060-task-15)'
alpine read /task/parent-060 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 060

- Status: Open

## Subtasks

- [060 Task 01 (Open)](/task/060-task-01)

- [060 Task 02 (Open)](/task/060-task-02)

- [060 Task 03 (Open)](/task/060-task-03)

- [060 Moved new 1 (Open)](/task/060-moved-new-1)

- [060 Moved new 2 (Open)](/task/060-moved-new-2)

- [060 Moved new 3 (Open)](/task/060-moved-new-3)

- [060 Task 10 (Open)](/task/060-task-10)

- [060 Task 11 (Open)](/task/060-task-11)

- [060 Task 04 (Open)](/task/060-task-04)

- [060 Task 05 (Open)](/task/060-task-05)

- [060 Task 06 (Open)](/task/060-task-06)

- [060 Task 07 (Open)](/task/060-task-07)

- [060 Task 08 (Open)](/task/060-task-08)

- [060 Task 09 (Open)](/task/060-task-09)

- [060 Task 12 (Open)](/task/060-task-12)

- [060 Task 13 (Open)](/task/060-task-13)

- [060 Task 14 (Open)](/task/060-task-14)

- [060 Task 15 (Open)](/task/060-task-15)
`);
});

test("one existing task to start; task subtasks page head; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 061

## Subtasks

- 061 Task 01 (Open)
- 061 Task 02 (Open)
- 061 Task 03 (Open)
- 061 Task 04 (Open)
- 061 Task 05 (Open)
- 061 Task 06 (Open)
- 061 Task 07 (Open)
- 061 Task 08 (Open)
- 061 Task 09 (Open)
- 061 Task 10 (Open)
- 061 Task 11 (Open)
- 061 Task 12 (Open)
- 061 Task 13 (Open)
- 061 Task 14 (Open)
- 061 Task 15 (Open)
- 061 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 061](/task/parent-061).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-061/subtasks --limit 850b >/dev/null
alpine update /task/parent-061/subtasks \\
  --old '- [061 Task 01 (Open)](/task/061-task-01)

- [061 Task 02 (Open)](/task/061-task-02)

- [061 Task 03 (Open)](/task/061-task-03)

- [061 Task 04 (Open)](/task/061-task-04)

- [061 Task 05 (Open)](/task/061-task-05)

- [061 Task 06 (Open)](/task/061-task-06)

- [061 Task 07 (Open)](/task/061-task-07)

- [061 Task 08 (Open)](/task/061-task-08)

- [061 Task 09 (Open)](/task/061-task-09)

- [061 Task 10 (Open)](/task/061-task-10)

- [061 Task 11 (Open)](/task/061-task-11)

- [061 Task 12 (Open)](/task/061-task-12)

- [061 Task 13 (Open)](/task/061-task-13)

- [061 Task 14 (Open)](/task/061-task-14)

- [061 Task 15 (Open)](/task/061-task-15)' \\
  --new '- [061 Task 10 (Open)](/task/061-task-10)

- [061 Task 01 (Open)](/task/061-task-01)

- [061 Task 02 (Open)](/task/061-task-02)

- [061 Task 03 (Open)](/task/061-task-03)

- [061 Task 04 (Open)](/task/061-task-04)

- [061 Task 05 (Open)](/task/061-task-05)

- [061 Task 06 (Open)](/task/061-task-06)

- [061 Task 07 (Open)](/task/061-task-07)

- [061 Task 08 (Open)](/task/061-task-08)

- [061 Task 09 (Open)](/task/061-task-09)

- [061 Task 11 (Open)](/task/061-task-11)

- [061 Task 12 (Open)](/task/061-task-12)

- [061 Task 13 (Open)](/task/061-task-13)

- [061 Task 14 (Open)](/task/061-task-14)

- [061 Task 15 (Open)](/task/061-task-15)'
alpine read /task/parent-061/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 061 (Open)](/task/parent-061).

- [061 Task 10 (Open)](/task/061-task-10)

- [061 Task 01 (Open)](/task/061-task-01)

- [061 Task 02 (Open)](/task/061-task-02)

- [061 Task 03 (Open)](/task/061-task-03)

- [061 Task 04 (Open)](/task/061-task-04)

- [061 Task 05 (Open)](/task/061-task-05)

- [061 Task 06 (Open)](/task/061-task-06)

- [061 Task 07 (Open)](/task/061-task-07)

- [061 Task 08 (Open)](/task/061-task-08)

- [061 Task 09 (Open)](/task/061-task-09)

- [061 Task 11 (Open)](/task/061-task-11)

- [061 Task 12 (Open)](/task/061-task-12)

- [061 Task 13 (Open)](/task/061-task-13)

- [061 Task 14 (Open)](/task/061-task-14)

- [061 Task 15 (Open)](/task/061-task-15)

- [061 After pagination guard with a deliberately long title (Open)](/task/061-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task subtasks page tail that is not the end; one other task created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 062

## Subtasks

- 062 Before (Open)
- 062 Task 01 (Open)
- 062 Task 02 (Open)
- 062 Task 03 (Open)
- 062 Task 04 (Open)
- 062 Task 05 (Open)
- 062 Task 06 (Open)
- 062 Task 07 (Open)
- 062 Task 08 (Open)
- 062 Task 09 (Open)
- 062 Task 10 (Open)
- 062 Task 11 (Open)
- 062 Task 12 (Open)
- 062 Task 13 (Open)
- 062 Task 14 (Open)
- 062 Task 15 (Open)
- 062 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 062](/task/parent-062).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-062/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [062 Task 01 (Open)](/task/062-task-01)

- [062 Task 02 (Open)](/task/062-task-02)

- [062 Task 03 (Open)](/task/062-task-03)

- [062 Task 04 (Open)](/task/062-task-04)

- [062 Task 05 (Open)](/task/062-task-05)

- [062 Task 06 (Open)](/task/062-task-06)

- [062 Task 07 (Open)](/task/062-task-07)

- [062 Task 08 (Open)](/task/062-task-08)

- [062 Task 09 (Open)](/task/062-task-09)

- [062 Task 10 (Open)](/task/062-task-10)

- [062 Task 11 (Open)](/task/062-task-11)

- [062 Task 12 (Open)](/task/062-task-12)

- [062 Task 13 (Open)](/task/062-task-13)

- [062 Task 14 (Open)](/task/062-task-14)

- [062 Task 15 (Open)](/task/062-task-15)' \\
  --new '- [062 Task 10 (Open)](/task/062-task-10)

- [062 Task 01 (Open)](/task/062-task-01)

- [062 Task 02 (Open)](/task/062-task-02)

- [062 Task 03 (Open)](/task/062-task-03)

- [062 Task 04 (Open)](/task/062-task-04)

- [062 Task 05 (Open)](/task/062-task-05)

- [062 Task 06 (Open)](/task/062-task-06)

- [062 Task 07 (Open)](/task/062-task-07)

- 062 Condition new 1 (Open)

- [062 Task 08 (Open)](/task/062-task-08)

- [062 Task 09 (Open)](/task/062-task-09)

- [062 Task 11 (Open)](/task/062-task-11)

- [062 Task 12 (Open)](/task/062-task-12)

- [062 Task 13 (Open)](/task/062-task-13)

- [062 Task 14 (Open)](/task/062-task-14)

- [062 Task 15 (Open)](/task/062-task-15)'
alpine read /task/parent-062/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 062 (Open)](/task/parent-062).

- [062 Before (Open)](/task/062-before)

- [062 Task 10 (Open)](/task/062-task-10)

- [062 Task 01 (Open)](/task/062-task-01)

- [062 Task 02 (Open)](/task/062-task-02)

- [062 Task 03 (Open)](/task/062-task-03)

- [062 Task 04 (Open)](/task/062-task-04)

- [062 Task 05 (Open)](/task/062-task-05)

- [062 Task 06 (Open)](/task/062-task-06)

- [062 Task 07 (Open)](/task/062-task-07)

- [062 Condition new 1 (Open)](/task/062-condition-new-1)

- [062 Task 08 (Open)](/task/062-task-08)

- [062 Task 09 (Open)](/task/062-task-09)

- [062 Task 11 (Open)](/task/062-task-11)

- [062 Task 12 (Open)](/task/062-task-12)

- [062 Task 13 (Open)](/task/062-task-13)

- [062 Task 14 (Open)](/task/062-task-14)

- [062 Task 15 (Open)](/task/062-task-15)

- [062 After pagination guard with a deliberately long title (Open)](/task/062-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task subtasks page tail at the end; two other adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 063

## Subtasks

- 063 Before (Open)
- 063 Task 01 (Open)
- 063 Task 02 (Open)
- 063 Task 03 (Open)
- 063 Task 04 (Open)
- 063 Task 05 (Open)
- 063 Task 06 (Open)
- 063 Task 07 (Open)
- 063 Task 08 (Open)
- 063 Task 09 (Open)
- 063 Task 10 (Open)
- 063 Task 11 (Open)
- 063 Task 12 (Open)
- 063 Task 13 (Open)
- 063 Task 14 (Open)
- 063 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 063](/task/parent-063).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-063/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [063 Task 01 (Open)](/task/063-task-01)

- [063 Task 02 (Open)](/task/063-task-02)

- [063 Task 03 (Open)](/task/063-task-03)

- [063 Task 04 (Open)](/task/063-task-04)

- [063 Task 05 (Open)](/task/063-task-05)

- [063 Task 06 (Open)](/task/063-task-06)

- [063 Task 07 (Open)](/task/063-task-07)

- [063 Task 08 (Open)](/task/063-task-08)

- [063 Task 09 (Open)](/task/063-task-09)

- [063 Task 10 (Open)](/task/063-task-10)

- [063 Task 11 (Open)](/task/063-task-11)

- [063 Task 12 (Open)](/task/063-task-12)

- [063 Task 13 (Open)](/task/063-task-13)

- [063 Task 14 (Open)](/task/063-task-14)

- [063 Task 15 (Open)](/task/063-task-15)' \\
  --new '- [063 Task 10 (Open)](/task/063-task-10)

- [063 Task 01 (Open)](/task/063-task-01)

- [063 Task 02 (Open)](/task/063-task-02)

- [063 Task 03 (Open)](/task/063-task-03)

- [063 Task 04 (Open)](/task/063-task-04)

- [063 Task 05 (Open)](/task/063-task-05)

- [063 Task 06 (Open)](/task/063-task-06)

- [063 Task 07 (Open)](/task/063-task-07)

- 063 Condition new 1 (Open)

- 063 Condition new 2 (Open)

- [063 Task 08 (Open)](/task/063-task-08)

- [063 Task 09 (Open)](/task/063-task-09)

- [063 Task 11 (Open)](/task/063-task-11)

- [063 Task 12 (Open)](/task/063-task-12)

- [063 Task 13 (Open)](/task/063-task-13)

- [063 Task 14 (Open)](/task/063-task-14)

- [063 Task 15 (Open)](/task/063-task-15)'
alpine read /task/parent-063/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 063 (Open)](/task/parent-063).

- [063 Before (Open)](/task/063-before)

- [063 Task 10 (Open)](/task/063-task-10)

- [063 Task 01 (Open)](/task/063-task-01)

- [063 Task 02 (Open)](/task/063-task-02)

- [063 Task 03 (Open)](/task/063-task-03)

- [063 Task 04 (Open)](/task/063-task-04)

- [063 Task 05 (Open)](/task/063-task-05)

- [063 Task 06 (Open)](/task/063-task-06)

- [063 Task 07 (Open)](/task/063-task-07)

- [063 Condition new 1 (Open)](/task/063-condition-new-1)

- [063 Condition new 2 (Open)](/task/063-condition-new-2)

- [063 Task 08 (Open)](/task/063-task-08)

- [063 Task 09 (Open)](/task/063-task-09)

- [063 Task 11 (Open)](/task/063-task-11)

- [063 Task 12 (Open)](/task/063-task-12)

- [063 Task 13 (Open)](/task/063-task-13)

- [063 Task 14 (Open)](/task/063-task-14)

- [063 Task 15 (Open)](/task/063-task-15)

End of tasks.
`);
});

test("one existing task to start; task collection page head; two other non-adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 064

- 064 Task 01 (Open)
- 064 Task 02 (Open)
- 064 Task 03 (Open)
- 064 Task 04 (Open)
- 064 Task 05 (Open)
- 064 Task 06 (Open)
- 064 Task 07 (Open)
- 064 Task 08 (Open)
- 064 Task 09 (Open)
- 064 Task 10 (Open)
- 064 Task 11 (Open)
- 064 Task 12 (Open)
- 064 Task 13 (Open)
- 064 Task 14 (Open)
- 064 Task 15 (Open)
- 064 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 064](/task-collection/roadmap-064).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-064 --limit 850b >/dev/null
alpine update /task-collection/roadmap-064 \\
  --old '- [064 Task 01 (Open)](/task/064-task-01)

- [064 Task 02 (Open)](/task/064-task-02)

- [064 Task 03 (Open)](/task/064-task-03)

- [064 Task 04 (Open)](/task/064-task-04)

- [064 Task 05 (Open)](/task/064-task-05)

- [064 Task 06 (Open)](/task/064-task-06)

- [064 Task 07 (Open)](/task/064-task-07)

- [064 Task 08 (Open)](/task/064-task-08)

- [064 Task 09 (Open)](/task/064-task-09)

- [064 Task 10 (Open)](/task/064-task-10)

- [064 Task 11 (Open)](/task/064-task-11)

- [064 Task 12 (Open)](/task/064-task-12)

- [064 Task 13 (Open)](/task/064-task-13)

- [064 Task 14 (Open)](/task/064-task-14)

- [064 Task 15 (Open)](/task/064-task-15)' \\
  --new '- 064 Condition new 2 (Open)

- [064 Task 10 (Open)](/task/064-task-10)

- [064 Task 01 (Open)](/task/064-task-01)

- [064 Task 02 (Open)](/task/064-task-02)

- [064 Task 03 (Open)](/task/064-task-03)

- [064 Task 04 (Open)](/task/064-task-04)

- [064 Task 05 (Open)](/task/064-task-05)

- [064 Task 06 (Open)](/task/064-task-06)

- 064 Condition new 1 (Open)

- [064 Task 07 (Open)](/task/064-task-07)

- [064 Task 08 (Open)](/task/064-task-08)

- [064 Task 09 (Open)](/task/064-task-09)

- [064 Task 11 (Open)](/task/064-task-11)

- [064 Task 12 (Open)](/task/064-task-12)

- [064 Task 13 (Open)](/task/064-task-13)

- [064 Task 14 (Open)](/task/064-task-14)

- [064 Task 15 (Open)](/task/064-task-15)'
alpine read /task-collection/roadmap-064 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 064

- [064 Condition new 2 (Open)](/task/064-condition-new-2)

- [064 Task 10 (Open)](/task/064-task-10)

- [064 Task 01 (Open)](/task/064-task-01)

- [064 Task 02 (Open)](/task/064-task-02)

- [064 Task 03 (Open)](/task/064-task-03)

- [064 Task 04 (Open)](/task/064-task-04)

- [064 Task 05 (Open)](/task/064-task-05)

- [064 Task 06 (Open)](/task/064-task-06)

- [064 Condition new 1 (Open)](/task/064-condition-new-1)

- [064 Task 07 (Open)](/task/064-task-07)

- [064 Task 08 (Open)](/task/064-task-08)

- [064 Task 09 (Open)](/task/064-task-09)

- [064 Task 11 (Open)](/task/064-task-11)

- [064 Task 12 (Open)](/task/064-task-12)

- [064 Task 13 (Open)](/task/064-task-13)

- [064 Task 14 (Open)](/task/064-task-14)

- [064 Task 15 (Open)](/task/064-task-15)

- [064 After pagination guard with a deliberately long title (Open)](/task/064-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task collection page tail that is not the end; one other task created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 065

- 065 Before (Open)
- 065 Task 01 (Open)
- 065 Task 02 (Open)
- 065 Task 03 (Open)
- 065 Task 04 (Open)
- 065 Task 05 (Open)
- 065 Task 06 (Open)
- 065 Task 07 (Open)
- 065 Task 08 (Open)
- 065 Task 09 (Open)
- 065 Task 10 (Open)
- 065 Task 11 (Open)
- 065 Task 12 (Open)
- 065 Task 13 (Open)
- 065 Task 14 (Open)
- 065 Task 15 (Open)
- 065 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 065](/task-collection/roadmap-065).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-065 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [065 Task 01 (Open)](/task/065-task-01)

- [065 Task 02 (Open)](/task/065-task-02)

- [065 Task 03 (Open)](/task/065-task-03)

- [065 Task 04 (Open)](/task/065-task-04)

- [065 Task 05 (Open)](/task/065-task-05)

- [065 Task 06 (Open)](/task/065-task-06)

- [065 Task 07 (Open)](/task/065-task-07)

- [065 Task 08 (Open)](/task/065-task-08)

- [065 Task 09 (Open)](/task/065-task-09)

- [065 Task 10 (Open)](/task/065-task-10)

- [065 Task 11 (Open)](/task/065-task-11)

- [065 Task 12 (Open)](/task/065-task-12)

- [065 Task 13 (Open)](/task/065-task-13)

- [065 Task 14 (Open)](/task/065-task-14)

- [065 Task 15 (Open)](/task/065-task-15)' \\
  --new '- [065 Task 01 (Open)](/task/065-task-01)

- [065 Task 02 (Open)](/task/065-task-02)

- [065 Task 03 (Open)](/task/065-task-03)

- [065 Task 04 (Open)](/task/065-task-04)

- [065 Task 05 (Open)](/task/065-task-05)

- [065 Task 06 (Open)](/task/065-task-06)

- [065 Task 07 (Open)](/task/065-task-07)

- 065 Condition previous 1 (Open)

- [065 Task 08 (Open)](/task/065-task-08)

- [065 Task 09 (Open)](/task/065-task-09)

- [065 Task 10 (Open)](/task/065-task-10)

- [065 Task 11 (Open)](/task/065-task-11)

- [065 Task 12 (Open)](/task/065-task-12)

- [065 Task 13 (Open)](/task/065-task-13)

- [065 Task 14 (Open)](/task/065-task-14)

- [065 Task 15 (Open)](/task/065-task-15)'
alpine update $path \\
  --old '- [065 Task 01 (Open)](/task/065-task-01)

- [065 Task 02 (Open)](/task/065-task-02)

- [065 Task 03 (Open)](/task/065-task-03)

- [065 Task 04 (Open)](/task/065-task-04)

- [065 Task 05 (Open)](/task/065-task-05)

- [065 Task 06 (Open)](/task/065-task-06)

- [065 Task 07 (Open)](/task/065-task-07)

- 065 Condition previous 1 (Open)

- [065 Task 08 (Open)](/task/065-task-08)

- [065 Task 09 (Open)](/task/065-task-09)

- [065 Task 10 (Open)](/task/065-task-10)

- [065 Task 11 (Open)](/task/065-task-11)

- [065 Task 12 (Open)](/task/065-task-12)

- [065 Task 13 (Open)](/task/065-task-13)

- [065 Task 14 (Open)](/task/065-task-14)

- [065 Task 15 (Open)](/task/065-task-15)' \\
  --new '- [065 Task 10 (Open)](/task/065-task-10)

- [065 Task 01 (Open)](/task/065-task-01)

- [065 Task 02 (Open)](/task/065-task-02)

- [065 Task 03 (Open)](/task/065-task-03)

- [065 Task 04 (Open)](/task/065-task-04)

- [065 Task 05 (Open)](/task/065-task-05)

- [065 Task 06 (Open)](/task/065-task-06)

- [065 Task 07 (Open)](/task/065-task-07)

- 065 Condition previous 1 (Open)

- [065 Task 08 (Open)](/task/065-task-08)

- [065 Task 09 (Open)](/task/065-task-09)

- [065 Task 11 (Open)](/task/065-task-11)

- [065 Task 12 (Open)](/task/065-task-12)

- [065 Task 13 (Open)](/task/065-task-13)

- [065 Task 14 (Open)](/task/065-task-14)

- [065 Task 15 (Open)](/task/065-task-15)'
alpine read /task-collection/roadmap-065 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 065

- [065 Before (Open)](/task/065-before)

- [065 Task 10 (Open)](/task/065-task-10)

- [065 Task 01 (Open)](/task/065-task-01)

- [065 Task 02 (Open)](/task/065-task-02)

- [065 Task 03 (Open)](/task/065-task-03)

- [065 Task 04 (Open)](/task/065-task-04)

- [065 Task 05 (Open)](/task/065-task-05)

- [065 Task 06 (Open)](/task/065-task-06)

- [065 Task 07 (Open)](/task/065-task-07)

- [065 Condition previous 1 (Open)](/task/065-condition-previous-1)

- [065 Task 08 (Open)](/task/065-task-08)

- [065 Task 09 (Open)](/task/065-task-09)

- [065 Task 11 (Open)](/task/065-task-11)

- [065 Task 12 (Open)](/task/065-task-12)

- [065 Task 13 (Open)](/task/065-task-13)

- [065 Task 14 (Open)](/task/065-task-14)

- [065 Task 15 (Open)](/task/065-task-15)

- [065 After pagination guard with a deliberately long title (Open)](/task/065-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task collection page tail at the end; two other adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 066

- 066 Before (Open)
- 066 Task 01 (Open)
- 066 Task 02 (Open)
- 066 Task 03 (Open)
- 066 Task 04 (Open)
- 066 Task 05 (Open)
- 066 Task 06 (Open)
- 066 Task 07 (Open)
- 066 Task 08 (Open)
- 066 Task 09 (Open)
- 066 Task 10 (Open)
- 066 Task 11 (Open)
- 066 Task 12 (Open)
- 066 Task 13 (Open)
- 066 Task 14 (Open)
- 066 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 066](/task-collection/roadmap-066).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-066 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [066 Task 01 (Open)](/task/066-task-01)

- [066 Task 02 (Open)](/task/066-task-02)

- [066 Task 03 (Open)](/task/066-task-03)

- [066 Task 04 (Open)](/task/066-task-04)

- [066 Task 05 (Open)](/task/066-task-05)

- [066 Task 06 (Open)](/task/066-task-06)

- [066 Task 07 (Open)](/task/066-task-07)

- [066 Task 08 (Open)](/task/066-task-08)

- [066 Task 09 (Open)](/task/066-task-09)

- [066 Task 10 (Open)](/task/066-task-10)

- [066 Task 11 (Open)](/task/066-task-11)

- [066 Task 12 (Open)](/task/066-task-12)

- [066 Task 13 (Open)](/task/066-task-13)

- [066 Task 14 (Open)](/task/066-task-14)

- [066 Task 15 (Open)](/task/066-task-15)' \\
  --new '- [066 Task 01 (Open)](/task/066-task-01)

- [066 Task 02 (Open)](/task/066-task-02)

- [066 Task 03 (Open)](/task/066-task-03)

- [066 Task 04 (Open)](/task/066-task-04)

- [066 Task 05 (Open)](/task/066-task-05)

- [066 Task 06 (Open)](/task/066-task-06)

- [066 Task 07 (Open)](/task/066-task-07)

- 066 Condition previous 1 (Open)

- 066 Condition previous 2 (Open)

- [066 Task 08 (Open)](/task/066-task-08)

- [066 Task 09 (Open)](/task/066-task-09)

- [066 Task 10 (Open)](/task/066-task-10)

- [066 Task 11 (Open)](/task/066-task-11)

- [066 Task 12 (Open)](/task/066-task-12)

- [066 Task 13 (Open)](/task/066-task-13)

- [066 Task 14 (Open)](/task/066-task-14)

- [066 Task 15 (Open)](/task/066-task-15)'
alpine update $path \\
  --old '- [066 Task 01 (Open)](/task/066-task-01)

- [066 Task 02 (Open)](/task/066-task-02)

- [066 Task 03 (Open)](/task/066-task-03)

- [066 Task 04 (Open)](/task/066-task-04)

- [066 Task 05 (Open)](/task/066-task-05)

- [066 Task 06 (Open)](/task/066-task-06)

- [066 Task 07 (Open)](/task/066-task-07)

- 066 Condition previous 1 (Open)

- 066 Condition previous 2 (Open)

- [066 Task 08 (Open)](/task/066-task-08)

- [066 Task 09 (Open)](/task/066-task-09)

- [066 Task 10 (Open)](/task/066-task-10)

- [066 Task 11 (Open)](/task/066-task-11)

- [066 Task 12 (Open)](/task/066-task-12)

- [066 Task 13 (Open)](/task/066-task-13)

- [066 Task 14 (Open)](/task/066-task-14)

- [066 Task 15 (Open)](/task/066-task-15)' \\
  --new '- [066 Task 10 (Open)](/task/066-task-10)

- [066 Task 01 (Open)](/task/066-task-01)

- [066 Task 02 (Open)](/task/066-task-02)

- [066 Task 03 (Open)](/task/066-task-03)

- [066 Task 04 (Open)](/task/066-task-04)

- [066 Task 05 (Open)](/task/066-task-05)

- [066 Task 06 (Open)](/task/066-task-06)

- [066 Task 07 (Open)](/task/066-task-07)

- 066 Condition previous 1 (Open)

- 066 Condition previous 2 (Open)

- [066 Task 08 (Open)](/task/066-task-08)

- [066 Task 09 (Open)](/task/066-task-09)

- [066 Task 11 (Open)](/task/066-task-11)

- [066 Task 12 (Open)](/task/066-task-12)

- [066 Task 13 (Open)](/task/066-task-13)

- [066 Task 14 (Open)](/task/066-task-14)

- [066 Task 15 (Open)](/task/066-task-15)'
alpine read /task-collection/roadmap-066 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 066

- [066 Before (Open)](/task/066-before)

- [066 Task 10 (Open)](/task/066-task-10)

- [066 Task 01 (Open)](/task/066-task-01)

- [066 Task 02 (Open)](/task/066-task-02)

- [066 Task 03 (Open)](/task/066-task-03)

- [066 Task 04 (Open)](/task/066-task-04)

- [066 Task 05 (Open)](/task/066-task-05)

- [066 Task 06 (Open)](/task/066-task-06)

- [066 Task 07 (Open)](/task/066-task-07)

- [066 Condition previous 1 (Open)](/task/066-condition-previous-1)

- [066 Condition previous 2 (Open)](/task/066-condition-previous-2)

- [066 Task 08 (Open)](/task/066-task-08)

- [066 Task 09 (Open)](/task/066-task-09)

- [066 Task 11 (Open)](/task/066-task-11)

- [066 Task 12 (Open)](/task/066-task-12)

- [066 Task 13 (Open)](/task/066-task-13)

- [066 Task 14 (Open)](/task/066-task-14)

- [066 Task 15 (Open)](/task/066-task-15)

End of tasks.
`);
});

test("one existing task to start; task page subtasks list; two other non-adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 067

## Subtasks

- 067 Task 01 (Open)
- 067 Task 02 (Open)
- 067 Task 03 (Open)
- 067 Task 04 (Open)
- 067 Task 05 (Open)
- 067 Task 06 (Open)
- 067 Task 07 (Open)
- 067 Task 08 (Open)
- 067 Task 09 (Open)
- 067 Task 10 (Open)
- 067 Task 11 (Open)
- 067 Task 12 (Open)
- 067 Task 13 (Open)
- 067 Task 14 (Open)
- 067 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 067](/task/parent-067).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-067 --limit 100kb >/dev/null
alpine update /task/parent-067 \\
  --old '- [067 Task 01 (Open)](/task/067-task-01)

- [067 Task 02 (Open)](/task/067-task-02)

- [067 Task 03 (Open)](/task/067-task-03)

- [067 Task 04 (Open)](/task/067-task-04)

- [067 Task 05 (Open)](/task/067-task-05)

- [067 Task 06 (Open)](/task/067-task-06)

- [067 Task 07 (Open)](/task/067-task-07)

- [067 Task 08 (Open)](/task/067-task-08)

- [067 Task 09 (Open)](/task/067-task-09)

- [067 Task 10 (Open)](/task/067-task-10)

- [067 Task 11 (Open)](/task/067-task-11)

- [067 Task 12 (Open)](/task/067-task-12)

- [067 Task 13 (Open)](/task/067-task-13)

- [067 Task 14 (Open)](/task/067-task-14)

- [067 Task 15 (Open)](/task/067-task-15)' \\
  --new '- [067 Task 01 (Open)](/task/067-task-01)

- [067 Task 02 (Open)](/task/067-task-02)

- [067 Task 03 (Open)](/task/067-task-03)

- [067 Task 04 (Open)](/task/067-task-04)

- [067 Task 05 (Open)](/task/067-task-05)

- [067 Task 06 (Open)](/task/067-task-06)

- 067 Condition previous 1 (Open)

- [067 Task 07 (Open)](/task/067-task-07)

- [067 Task 08 (Open)](/task/067-task-08)

- [067 Task 09 (Open)](/task/067-task-09)

- 067 Condition previous 2 (Open)

- [067 Task 10 (Open)](/task/067-task-10)

- [067 Task 11 (Open)](/task/067-task-11)

- [067 Task 12 (Open)](/task/067-task-12)

- [067 Task 13 (Open)](/task/067-task-13)

- [067 Task 14 (Open)](/task/067-task-14)

- [067 Task 15 (Open)](/task/067-task-15)'
alpine update /task/parent-067 \\
  --old '- [067 Task 01 (Open)](/task/067-task-01)

- [067 Task 02 (Open)](/task/067-task-02)

- [067 Task 03 (Open)](/task/067-task-03)

- [067 Task 04 (Open)](/task/067-task-04)

- [067 Task 05 (Open)](/task/067-task-05)

- [067 Task 06 (Open)](/task/067-task-06)

- 067 Condition previous 1 (Open)

- [067 Task 07 (Open)](/task/067-task-07)

- [067 Task 08 (Open)](/task/067-task-08)

- [067 Task 09 (Open)](/task/067-task-09)

- 067 Condition previous 2 (Open)

- [067 Task 10 (Open)](/task/067-task-10)

- [067 Task 11 (Open)](/task/067-task-11)

- [067 Task 12 (Open)](/task/067-task-12)

- [067 Task 13 (Open)](/task/067-task-13)

- [067 Task 14 (Open)](/task/067-task-14)

- [067 Task 15 (Open)](/task/067-task-15)' \\
  --new '- [067 Task 10 (Open)](/task/067-task-10)

- [067 Task 01 (Open)](/task/067-task-01)

- [067 Task 02 (Open)](/task/067-task-02)

- [067 Task 03 (Open)](/task/067-task-03)

- [067 Task 04 (Open)](/task/067-task-04)

- [067 Task 05 (Open)](/task/067-task-05)

- [067 Task 06 (Open)](/task/067-task-06)

- 067 Condition previous 1 (Open)

- [067 Task 07 (Open)](/task/067-task-07)

- [067 Task 08 (Open)](/task/067-task-08)

- [067 Task 09 (Open)](/task/067-task-09)

- 067 Condition previous 2 (Open)

- [067 Task 11 (Open)](/task/067-task-11)

- [067 Task 12 (Open)](/task/067-task-12)

- [067 Task 13 (Open)](/task/067-task-13)

- [067 Task 14 (Open)](/task/067-task-14)

- [067 Task 15 (Open)](/task/067-task-15)'
alpine read /task/parent-067 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 067

- Status: Open

## Subtasks

- [067 Task 10 (Open)](/task/067-task-10)

- [067 Task 01 (Open)](/task/067-task-01)

- [067 Task 02 (Open)](/task/067-task-02)

- [067 Task 03 (Open)](/task/067-task-03)

- [067 Task 04 (Open)](/task/067-task-04)

- [067 Task 05 (Open)](/task/067-task-05)

- [067 Task 06 (Open)](/task/067-task-06)

- [067 Condition previous 1 (Open)](/task/067-condition-previous-1)

- [067 Task 07 (Open)](/task/067-task-07)

- [067 Task 08 (Open)](/task/067-task-08)

- [067 Task 09 (Open)](/task/067-task-09)

- [067 Condition previous 2 (Open)](/task/067-condition-previous-2)

- [067 Task 11 (Open)](/task/067-task-11)

- [067 Task 12 (Open)](/task/067-task-12)

- [067 Task 13 (Open)](/task/067-task-13)

- [067 Task 14 (Open)](/task/067-task-14)

- [067 Task 15 (Open)](/task/067-task-15)
`);
});

test("one existing task to start; task subtasks page head; one other existing task moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 068

## Subtasks

- 068 Task 01 (Open)
- 068 Task 02 (Open)
- 068 Task 03 (Open)
- 068 Task 04 (Open)
- 068 Task 05 (Open)
- 068 Task 06 (Open)
- 068 Task 07 (Open)
- 068 Task 08 (Open)
- 068 Task 09 (Open)
- 068 Task 10 (Open)
- 068 Task 11 (Open)
- 068 Task 12 (Open)
- 068 Task 13 (Open)
- 068 Task 14 (Open)
- 068 Task 15 (Open)
- 068 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 068](/task/parent-068).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-068/subtasks --limit 850b >/dev/null
alpine update /task/parent-068/subtasks \\
  --old '- [068 Task 01 (Open)](/task/068-task-01)

- [068 Task 02 (Open)](/task/068-task-02)

- [068 Task 03 (Open)](/task/068-task-03)

- [068 Task 04 (Open)](/task/068-task-04)

- [068 Task 05 (Open)](/task/068-task-05)

- [068 Task 06 (Open)](/task/068-task-06)

- [068 Task 07 (Open)](/task/068-task-07)

- [068 Task 08 (Open)](/task/068-task-08)

- [068 Task 09 (Open)](/task/068-task-09)

- [068 Task 10 (Open)](/task/068-task-10)

- [068 Task 11 (Open)](/task/068-task-11)

- [068 Task 12 (Open)](/task/068-task-12)

- [068 Task 13 (Open)](/task/068-task-13)

- [068 Task 14 (Open)](/task/068-task-14)

- [068 Task 15 (Open)](/task/068-task-15)' \\
  --new '- [068 Task 10 (Open)](/task/068-task-10)

- [068 Task 08 (Open)](/task/068-task-08)

- [068 Task 01 (Open)](/task/068-task-01)

- [068 Task 02 (Open)](/task/068-task-02)

- [068 Task 03 (Open)](/task/068-task-03)

- [068 Task 04 (Open)](/task/068-task-04)

- [068 Task 05 (Open)](/task/068-task-05)

- [068 Task 06 (Open)](/task/068-task-06)

- [068 Task 07 (Open)](/task/068-task-07)

- [068 Task 09 (Open)](/task/068-task-09)

- [068 Task 11 (Open)](/task/068-task-11)

- [068 Task 12 (Open)](/task/068-task-12)

- [068 Task 13 (Open)](/task/068-task-13)

- [068 Task 14 (Open)](/task/068-task-14)

- [068 Task 15 (Open)](/task/068-task-15)'
alpine read /task/parent-068/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 068 (Open)](/task/parent-068).

- [068 Task 10 (Open)](/task/068-task-10)

- [068 Task 08 (Open)](/task/068-task-08)

- [068 Task 01 (Open)](/task/068-task-01)

- [068 Task 02 (Open)](/task/068-task-02)

- [068 Task 03 (Open)](/task/068-task-03)

- [068 Task 04 (Open)](/task/068-task-04)

- [068 Task 05 (Open)](/task/068-task-05)

- [068 Task 06 (Open)](/task/068-task-06)

- [068 Task 07 (Open)](/task/068-task-07)

- [068 Task 09 (Open)](/task/068-task-09)

- [068 Task 11 (Open)](/task/068-task-11)

- [068 Task 12 (Open)](/task/068-task-12)

- [068 Task 13 (Open)](/task/068-task-13)

- [068 Task 14 (Open)](/task/068-task-14)

- [068 Task 15 (Open)](/task/068-task-15)

- [068 After pagination guard with a deliberately long title (Open)](/task/068-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task subtasks page tail that is not the end; two other existing tasks swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 069

## Subtasks

- 069 Before (Open)
- 069 Task 01 (Open)
- 069 Task 02 (Open)
- 069 Task 03 (Open)
- 069 Task 04 (Open)
- 069 Task 05 (Open)
- 069 Task 06 (Open)
- 069 Task 07 (Open)
- 069 Task 08 (Open)
- 069 Task 09 (Open)
- 069 Task 10 (Open)
- 069 Task 11 (Open)
- 069 Task 12 (Open)
- 069 Task 13 (Open)
- 069 Task 14 (Open)
- 069 Task 15 (Open)
- 069 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 069](/task/parent-069).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-069/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [069 Task 01 (Open)](/task/069-task-01)

- [069 Task 02 (Open)](/task/069-task-02)

- [069 Task 03 (Open)](/task/069-task-03)

- [069 Task 04 (Open)](/task/069-task-04)

- [069 Task 05 (Open)](/task/069-task-05)

- [069 Task 06 (Open)](/task/069-task-06)

- [069 Task 07 (Open)](/task/069-task-07)

- [069 Task 08 (Open)](/task/069-task-08)

- [069 Task 09 (Open)](/task/069-task-09)

- [069 Task 10 (Open)](/task/069-task-10)

- [069 Task 11 (Open)](/task/069-task-11)

- [069 Task 12 (Open)](/task/069-task-12)

- [069 Task 13 (Open)](/task/069-task-13)

- [069 Task 14 (Open)](/task/069-task-14)

- [069 Task 15 (Open)](/task/069-task-15)' \\
  --new '- [069 Task 10 (Open)](/task/069-task-10)

- [069 Task 01 (Open)](/task/069-task-01)

- [069 Task 02 (Open)](/task/069-task-02)

- [069 Task 03 (Open)](/task/069-task-03)

- [069 Task 04 (Open)](/task/069-task-04)

- [069 Task 05 (Open)](/task/069-task-05)

- [069 Task 06 (Open)](/task/069-task-06)

- [069 Task 09 (Open)](/task/069-task-09)

- [069 Task 08 (Open)](/task/069-task-08)

- [069 Task 07 (Open)](/task/069-task-07)

- [069 Task 11 (Open)](/task/069-task-11)

- [069 Task 12 (Open)](/task/069-task-12)

- [069 Task 13 (Open)](/task/069-task-13)

- [069 Task 14 (Open)](/task/069-task-14)

- [069 Task 15 (Open)](/task/069-task-15)'
alpine read /task/parent-069/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 069 (Open)](/task/parent-069).

- [069 Before (Open)](/task/069-before)

- [069 Task 10 (Open)](/task/069-task-10)

- [069 Task 01 (Open)](/task/069-task-01)

- [069 Task 02 (Open)](/task/069-task-02)

- [069 Task 03 (Open)](/task/069-task-03)

- [069 Task 04 (Open)](/task/069-task-04)

- [069 Task 05 (Open)](/task/069-task-05)

- [069 Task 06 (Open)](/task/069-task-06)

- [069 Task 09 (Open)](/task/069-task-09)

- [069 Task 08 (Open)](/task/069-task-08)

- [069 Task 07 (Open)](/task/069-task-07)

- [069 Task 11 (Open)](/task/069-task-11)

- [069 Task 12 (Open)](/task/069-task-12)

- [069 Task 13 (Open)](/task/069-task-13)

- [069 Task 14 (Open)](/task/069-task-14)

- [069 Task 15 (Open)](/task/069-task-15)

- [069 After pagination guard with a deliberately long title (Open)](/task/069-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to start; task subtasks page tail at the end; one other link-less task from the previous update moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 070

## Subtasks

- 070 Before (Open)
- 070 Task 01 (Open)
- 070 Task 02 (Open)
- 070 Task 03 (Open)
- 070 Task 04 (Open)
- 070 Task 05 (Open)
- 070 Task 06 (Open)
- 070 Task 07 (Open)
- 070 Task 08 (Open)
- 070 Task 09 (Open)
- 070 Task 10 (Open)
- 070 Task 11 (Open)
- 070 Task 12 (Open)
- 070 Task 13 (Open)
- 070 Task 14 (Open)
- 070 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 070](/task/parent-070).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-070/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [070 Task 01 (Open)](/task/070-task-01)

- [070 Task 02 (Open)](/task/070-task-02)

- [070 Task 03 (Open)](/task/070-task-03)

- [070 Task 04 (Open)](/task/070-task-04)

- [070 Task 05 (Open)](/task/070-task-05)

- [070 Task 06 (Open)](/task/070-task-06)

- [070 Task 07 (Open)](/task/070-task-07)

- [070 Task 08 (Open)](/task/070-task-08)

- [070 Task 09 (Open)](/task/070-task-09)

- [070 Task 10 (Open)](/task/070-task-10)

- [070 Task 11 (Open)](/task/070-task-11)

- [070 Task 12 (Open)](/task/070-task-12)

- [070 Task 13 (Open)](/task/070-task-13)

- [070 Task 14 (Open)](/task/070-task-14)

- [070 Task 15 (Open)](/task/070-task-15)' \\
  --new '- [070 Task 01 (Open)](/task/070-task-01)

- [070 Task 02 (Open)](/task/070-task-02)

- [070 Task 03 (Open)](/task/070-task-03)

- [070 Task 04 (Open)](/task/070-task-04)

- [070 Task 05 (Open)](/task/070-task-05)

- [070 Task 06 (Open)](/task/070-task-06)

- [070 Task 07 (Open)](/task/070-task-07)

- 070 Condition previous 1 (Open)

- [070 Task 08 (Open)](/task/070-task-08)

- [070 Task 09 (Open)](/task/070-task-09)

- [070 Task 10 (Open)](/task/070-task-10)

- [070 Task 11 (Open)](/task/070-task-11)

- [070 Task 12 (Open)](/task/070-task-12)

- [070 Task 13 (Open)](/task/070-task-13)

- [070 Task 14 (Open)](/task/070-task-14)

- [070 Task 15 (Open)](/task/070-task-15)'
alpine update $path \\
  --old '- [070 Task 01 (Open)](/task/070-task-01)

- [070 Task 02 (Open)](/task/070-task-02)

- [070 Task 03 (Open)](/task/070-task-03)

- [070 Task 04 (Open)](/task/070-task-04)

- [070 Task 05 (Open)](/task/070-task-05)

- [070 Task 06 (Open)](/task/070-task-06)

- [070 Task 07 (Open)](/task/070-task-07)

- 070 Condition previous 1 (Open)

- [070 Task 08 (Open)](/task/070-task-08)

- [070 Task 09 (Open)](/task/070-task-09)

- [070 Task 10 (Open)](/task/070-task-10)

- [070 Task 11 (Open)](/task/070-task-11)

- [070 Task 12 (Open)](/task/070-task-12)

- [070 Task 13 (Open)](/task/070-task-13)

- [070 Task 14 (Open)](/task/070-task-14)

- [070 Task 15 (Open)](/task/070-task-15)' \\
  --new '- [070 Task 10 (Open)](/task/070-task-10)

- 070 Condition previous 1 (Open)

- [070 Task 01 (Open)](/task/070-task-01)

- [070 Task 02 (Open)](/task/070-task-02)

- [070 Task 03 (Open)](/task/070-task-03)

- [070 Task 04 (Open)](/task/070-task-04)

- [070 Task 05 (Open)](/task/070-task-05)

- [070 Task 06 (Open)](/task/070-task-06)

- [070 Task 07 (Open)](/task/070-task-07)

- [070 Task 08 (Open)](/task/070-task-08)

- [070 Task 09 (Open)](/task/070-task-09)

- [070 Task 11 (Open)](/task/070-task-11)

- [070 Task 12 (Open)](/task/070-task-12)

- [070 Task 13 (Open)](/task/070-task-13)

- [070 Task 14 (Open)](/task/070-task-14)

- [070 Task 15 (Open)](/task/070-task-15)'
alpine read /task/parent-070/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 070 (Open)](/task/parent-070).

- [070 Before (Open)](/task/070-before)

- [070 Task 10 (Open)](/task/070-task-10)

- [070 Condition previous 1 (Open)](/task/070-condition-previous-1)

- [070 Task 01 (Open)](/task/070-task-01)

- [070 Task 02 (Open)](/task/070-task-02)

- [070 Task 03 (Open)](/task/070-task-03)

- [070 Task 04 (Open)](/task/070-task-04)

- [070 Task 05 (Open)](/task/070-task-05)

- [070 Task 06 (Open)](/task/070-task-06)

- [070 Task 07 (Open)](/task/070-task-07)

- [070 Task 08 (Open)](/task/070-task-08)

- [070 Task 09 (Open)](/task/070-task-09)

- [070 Task 11 (Open)](/task/070-task-11)

- [070 Task 12 (Open)](/task/070-task-12)

- [070 Task 13 (Open)](/task/070-task-13)

- [070 Task 14 (Open)](/task/070-task-14)

- [070 Task 15 (Open)](/task/070-task-15)

End of tasks.
`);
});

test("one existing task to start; task collection page head; two other link-less tasks from the previous update swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 071

- 071 Task 01 (Open)
- 071 Task 02 (Open)
- 071 Task 03 (Open)
- 071 Task 04 (Open)
- 071 Task 05 (Open)
- 071 Task 06 (Open)
- 071 Task 07 (Open)
- 071 Task 08 (Open)
- 071 Task 09 (Open)
- 071 Task 10 (Open)
- 071 Task 11 (Open)
- 071 Task 12 (Open)
- 071 Task 13 (Open)
- 071 Task 14 (Open)
- 071 Task 15 (Open)
- 071 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 071](/task-collection/roadmap-071).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-071 --limit 850b >/dev/null
alpine update /task-collection/roadmap-071 \\
  --old '- [071 Task 01 (Open)](/task/071-task-01)

- [071 Task 02 (Open)](/task/071-task-02)

- [071 Task 03 (Open)](/task/071-task-03)

- [071 Task 04 (Open)](/task/071-task-04)

- [071 Task 05 (Open)](/task/071-task-05)

- [071 Task 06 (Open)](/task/071-task-06)

- [071 Task 07 (Open)](/task/071-task-07)

- [071 Task 08 (Open)](/task/071-task-08)

- [071 Task 09 (Open)](/task/071-task-09)

- [071 Task 10 (Open)](/task/071-task-10)

- [071 Task 11 (Open)](/task/071-task-11)

- [071 Task 12 (Open)](/task/071-task-12)

- [071 Task 13 (Open)](/task/071-task-13)

- [071 Task 14 (Open)](/task/071-task-14)

- [071 Task 15 (Open)](/task/071-task-15)' \\
  --new '- [071 Task 01 (Open)](/task/071-task-01)

- [071 Task 02 (Open)](/task/071-task-02)

- [071 Task 03 (Open)](/task/071-task-03)

- [071 Task 04 (Open)](/task/071-task-04)

- [071 Task 05 (Open)](/task/071-task-05)

- [071 Task 06 (Open)](/task/071-task-06)

- 071 Condition previous 1 (Open)

- [071 Task 07 (Open)](/task/071-task-07)

- [071 Task 08 (Open)](/task/071-task-08)

- [071 Task 09 (Open)](/task/071-task-09)

- 071 Condition previous 2 (Open)

- [071 Task 10 (Open)](/task/071-task-10)

- [071 Task 11 (Open)](/task/071-task-11)

- [071 Task 12 (Open)](/task/071-task-12)

- [071 Task 13 (Open)](/task/071-task-13)

- [071 Task 14 (Open)](/task/071-task-14)

- [071 Task 15 (Open)](/task/071-task-15)'
alpine update /task-collection/roadmap-071 \\
  --old '- [071 Task 01 (Open)](/task/071-task-01)

- [071 Task 02 (Open)](/task/071-task-02)

- [071 Task 03 (Open)](/task/071-task-03)

- [071 Task 04 (Open)](/task/071-task-04)

- [071 Task 05 (Open)](/task/071-task-05)

- [071 Task 06 (Open)](/task/071-task-06)

- 071 Condition previous 1 (Open)

- [071 Task 07 (Open)](/task/071-task-07)

- [071 Task 08 (Open)](/task/071-task-08)

- [071 Task 09 (Open)](/task/071-task-09)

- 071 Condition previous 2 (Open)

- [071 Task 10 (Open)](/task/071-task-10)

- [071 Task 11 (Open)](/task/071-task-11)

- [071 Task 12 (Open)](/task/071-task-12)

- [071 Task 13 (Open)](/task/071-task-13)

- [071 Task 14 (Open)](/task/071-task-14)

- [071 Task 15 (Open)](/task/071-task-15)' \\
  --new '- [071 Task 10 (Open)](/task/071-task-10)

- [071 Task 01 (Open)](/task/071-task-01)

- [071 Task 02 (Open)](/task/071-task-02)

- [071 Task 03 (Open)](/task/071-task-03)

- [071 Task 04 (Open)](/task/071-task-04)

- [071 Task 05 (Open)](/task/071-task-05)

- [071 Task 06 (Open)](/task/071-task-06)

- 071 Condition previous 2 (Open)

- [071 Task 07 (Open)](/task/071-task-07)

- [071 Task 08 (Open)](/task/071-task-08)

- [071 Task 09 (Open)](/task/071-task-09)

- 071 Condition previous 1 (Open)

- [071 Task 11 (Open)](/task/071-task-11)

- [071 Task 12 (Open)](/task/071-task-12)

- [071 Task 13 (Open)](/task/071-task-13)

- [071 Task 14 (Open)](/task/071-task-14)

- [071 Task 15 (Open)](/task/071-task-15)'
alpine read /task-collection/roadmap-071 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 071

- [071 Task 10 (Open)](/task/071-task-10)

- [071 Task 01 (Open)](/task/071-task-01)

- [071 Task 02 (Open)](/task/071-task-02)

- [071 Task 03 (Open)](/task/071-task-03)

- [071 Task 04 (Open)](/task/071-task-04)

- [071 Task 05 (Open)](/task/071-task-05)

- [071 Task 06 (Open)](/task/071-task-06)

- [071 Condition previous 2 (Open)](/task/071-condition-previous-2)

- [071 Task 07 (Open)](/task/071-task-07)

- [071 Task 08 (Open)](/task/071-task-08)

- [071 Task 09 (Open)](/task/071-task-09)

- [071 Condition previous 1 (Open)](/task/071-condition-previous-1)

- [071 Task 11 (Open)](/task/071-task-11)

- [071 Task 12 (Open)](/task/071-task-12)

- [071 Task 13 (Open)](/task/071-task-13)

- [071 Task 14 (Open)](/task/071-task-14)

- [071 Task 15 (Open)](/task/071-task-15)

- [071 After pagination guard with a deliberately long title (Open)](/task/071-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task collection page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 072

- 072 Before (Open)
- 072 Task 01 (Open)
- 072 Task 02 (Open)
- 072 Task 03 (Open)
- 072 Task 04 (Open)
- 072 Task 05 (Open)
- 072 Task 06 (Open)
- 072 Task 07 (Open)
- 072 Task 08 (Open)
- 072 Task 09 (Open)
- 072 Task 10 (Open)
- 072 Task 11 (Open)
- 072 Task 12 (Open)
- 072 Task 13 (Open)
- 072 Task 14 (Open)
- 072 Task 15 (Open)
- 072 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 072](/task-collection/roadmap-072).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-072 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [072 Task 01 (Open)](/task/072-task-01)

- [072 Task 02 (Open)](/task/072-task-02)

- [072 Task 03 (Open)](/task/072-task-03)

- [072 Task 04 (Open)](/task/072-task-04)

- [072 Task 05 (Open)](/task/072-task-05)

- [072 Task 06 (Open)](/task/072-task-06)

- [072 Task 07 (Open)](/task/072-task-07)

- [072 Task 08 (Open)](/task/072-task-08)

- [072 Task 09 (Open)](/task/072-task-09)

- [072 Task 10 (Open)](/task/072-task-10)

- [072 Task 11 (Open)](/task/072-task-11)

- [072 Task 12 (Open)](/task/072-task-12)

- [072 Task 13 (Open)](/task/072-task-13)

- [072 Task 14 (Open)](/task/072-task-14)

- [072 Task 15 (Open)](/task/072-task-15)' \\
  --new '- [072 Task 01 (Open)](/task/072-task-01)

- [072 Task 03 (Open)](/task/072-task-03)

- [072 Task 04 (Open)](/task/072-task-04)

- [072 Task 05 (Open)](/task/072-task-05)

- [072 Task 06 (Open)](/task/072-task-06)

- [072 Task 07 (Open)](/task/072-task-07)

- [072 Task 08 (Open)](/task/072-task-08)

- [072 Task 09 (Open)](/task/072-task-09)

- [072 Task 10 (Open)](/task/072-task-10)

- [072 Task 11 (Open)](/task/072-task-11)

- [072 Task 12 (Open)](/task/072-task-12)

- [072 Task 13 (Open)](/task/072-task-13)

- [072 Task 14 (Open)](/task/072-task-14)

- [072 Task 15 (Open)](/task/072-task-15)

- [072 Task 02 (Open)](/task/072-task-02)'
alpine read /task-collection/roadmap-072 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 072

- [072 Before (Open)](/task/072-before)

- [072 Task 01 (Open)](/task/072-task-01)

- [072 Task 03 (Open)](/task/072-task-03)

- [072 Task 04 (Open)](/task/072-task-04)

- [072 Task 05 (Open)](/task/072-task-05)

- [072 Task 06 (Open)](/task/072-task-06)

- [072 Task 07 (Open)](/task/072-task-07)

- [072 Task 08 (Open)](/task/072-task-08)

- [072 Task 09 (Open)](/task/072-task-09)

- [072 Task 10 (Open)](/task/072-task-10)

- [072 Task 11 (Open)](/task/072-task-11)

- [072 Task 12 (Open)](/task/072-task-12)

- [072 Task 13 (Open)](/task/072-task-13)

- [072 Task 14 (Open)](/task/072-task-14)

- [072 Task 15 (Open)](/task/072-task-15)

- [072 Task 02 (Open)](/task/072-task-02)

- [072 After pagination guard with a deliberately long title (Open)](/task/072-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task collection page tail at the end; one other task created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 073

- 073 Before (Open)
- 073 Task 01 (Open)
- 073 Task 02 (Open)
- 073 Task 03 (Open)
- 073 Task 04 (Open)
- 073 Task 05 (Open)
- 073 Task 06 (Open)
- 073 Task 07 (Open)
- 073 Task 08 (Open)
- 073 Task 09 (Open)
- 073 Task 10 (Open)
- 073 Task 11 (Open)
- 073 Task 12 (Open)
- 073 Task 13 (Open)
- 073 Task 14 (Open)
- 073 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 073](/task-collection/roadmap-073).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-073 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [073 Task 01 (Open)](/task/073-task-01)

- [073 Task 02 (Open)](/task/073-task-02)

- [073 Task 03 (Open)](/task/073-task-03)

- [073 Task 04 (Open)](/task/073-task-04)

- [073 Task 05 (Open)](/task/073-task-05)

- [073 Task 06 (Open)](/task/073-task-06)

- [073 Task 07 (Open)](/task/073-task-07)

- [073 Task 08 (Open)](/task/073-task-08)

- [073 Task 09 (Open)](/task/073-task-09)

- [073 Task 10 (Open)](/task/073-task-10)

- [073 Task 11 (Open)](/task/073-task-11)

- [073 Task 12 (Open)](/task/073-task-12)

- [073 Task 13 (Open)](/task/073-task-13)

- [073 Task 14 (Open)](/task/073-task-14)

- [073 Task 15 (Open)](/task/073-task-15)' \\
  --new '- [073 Task 01 (Open)](/task/073-task-01)

- [073 Task 03 (Open)](/task/073-task-03)

- [073 Task 04 (Open)](/task/073-task-04)

- [073 Task 05 (Open)](/task/073-task-05)

- [073 Task 06 (Open)](/task/073-task-06)

- [073 Task 07 (Open)](/task/073-task-07)

- 073 Condition new 1 (Open)

- [073 Task 08 (Open)](/task/073-task-08)

- [073 Task 09 (Open)](/task/073-task-09)

- [073 Task 10 (Open)](/task/073-task-10)

- [073 Task 11 (Open)](/task/073-task-11)

- [073 Task 12 (Open)](/task/073-task-12)

- [073 Task 13 (Open)](/task/073-task-13)

- [073 Task 14 (Open)](/task/073-task-14)

- [073 Task 15 (Open)](/task/073-task-15)

- [073 Task 02 (Open)](/task/073-task-02)'
alpine read /task-collection/roadmap-073 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 073

- [073 Before (Open)](/task/073-before)

- [073 Task 01 (Open)](/task/073-task-01)

- [073 Task 03 (Open)](/task/073-task-03)

- [073 Task 04 (Open)](/task/073-task-04)

- [073 Task 05 (Open)](/task/073-task-05)

- [073 Task 06 (Open)](/task/073-task-06)

- [073 Task 07 (Open)](/task/073-task-07)

- [073 Condition new 1 (Open)](/task/073-condition-new-1)

- [073 Task 08 (Open)](/task/073-task-08)

- [073 Task 09 (Open)](/task/073-task-09)

- [073 Task 10 (Open)](/task/073-task-10)

- [073 Task 11 (Open)](/task/073-task-11)

- [073 Task 12 (Open)](/task/073-task-12)

- [073 Task 13 (Open)](/task/073-task-13)

- [073 Task 14 (Open)](/task/073-task-14)

- [073 Task 15 (Open)](/task/073-task-15)

- [073 Task 02 (Open)](/task/073-task-02)

End of tasks.
`);
});

test("one existing task to end; task page subtasks list; two other adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 074

## Subtasks

- 074 Task 01 (Open)
- 074 Task 02 (Open)
- 074 Task 03 (Open)
- 074 Task 04 (Open)
- 074 Task 05 (Open)
- 074 Task 06 (Open)
- 074 Task 07 (Open)
- 074 Task 08 (Open)
- 074 Task 09 (Open)
- 074 Task 10 (Open)
- 074 Task 11 (Open)
- 074 Task 12 (Open)
- 074 Task 13 (Open)
- 074 Task 14 (Open)
- 074 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 074](/task/parent-074).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-074 --limit 100kb >/dev/null
alpine update /task/parent-074 \\
  --old '- [074 Task 01 (Open)](/task/074-task-01)

- [074 Task 02 (Open)](/task/074-task-02)

- [074 Task 03 (Open)](/task/074-task-03)

- [074 Task 04 (Open)](/task/074-task-04)

- [074 Task 05 (Open)](/task/074-task-05)

- [074 Task 06 (Open)](/task/074-task-06)

- [074 Task 07 (Open)](/task/074-task-07)

- [074 Task 08 (Open)](/task/074-task-08)

- [074 Task 09 (Open)](/task/074-task-09)

- [074 Task 10 (Open)](/task/074-task-10)

- [074 Task 11 (Open)](/task/074-task-11)

- [074 Task 12 (Open)](/task/074-task-12)

- [074 Task 13 (Open)](/task/074-task-13)

- [074 Task 14 (Open)](/task/074-task-14)

- [074 Task 15 (Open)](/task/074-task-15)' \\
  --new '- [074 Task 01 (Open)](/task/074-task-01)

- [074 Task 03 (Open)](/task/074-task-03)

- [074 Task 04 (Open)](/task/074-task-04)

- [074 Task 05 (Open)](/task/074-task-05)

- [074 Task 06 (Open)](/task/074-task-06)

- [074 Task 07 (Open)](/task/074-task-07)

- 074 Condition new 1 (Open)

- 074 Condition new 2 (Open)

- [074 Task 08 (Open)](/task/074-task-08)

- [074 Task 09 (Open)](/task/074-task-09)

- [074 Task 10 (Open)](/task/074-task-10)

- [074 Task 11 (Open)](/task/074-task-11)

- [074 Task 12 (Open)](/task/074-task-12)

- [074 Task 13 (Open)](/task/074-task-13)

- [074 Task 14 (Open)](/task/074-task-14)

- [074 Task 15 (Open)](/task/074-task-15)

- [074 Task 02 (Open)](/task/074-task-02)'
alpine read /task/parent-074 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 074

- Status: Open

## Subtasks

- [074 Task 01 (Open)](/task/074-task-01)

- [074 Task 03 (Open)](/task/074-task-03)

- [074 Task 04 (Open)](/task/074-task-04)

- [074 Task 05 (Open)](/task/074-task-05)

- [074 Task 06 (Open)](/task/074-task-06)

- [074 Task 07 (Open)](/task/074-task-07)

- [074 Condition new 1 (Open)](/task/074-condition-new-1)

- [074 Condition new 2 (Open)](/task/074-condition-new-2)

- [074 Task 08 (Open)](/task/074-task-08)

- [074 Task 09 (Open)](/task/074-task-09)

- [074 Task 10 (Open)](/task/074-task-10)

- [074 Task 11 (Open)](/task/074-task-11)

- [074 Task 12 (Open)](/task/074-task-12)

- [074 Task 13 (Open)](/task/074-task-13)

- [074 Task 14 (Open)](/task/074-task-14)

- [074 Task 15 (Open)](/task/074-task-15)

- [074 Task 02 (Open)](/task/074-task-02)
`);
});

test("one existing task to end; task subtasks page head; two other non-adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 075

## Subtasks

- 075 Task 01 (Open)
- 075 Task 02 (Open)
- 075 Task 03 (Open)
- 075 Task 04 (Open)
- 075 Task 05 (Open)
- 075 Task 06 (Open)
- 075 Task 07 (Open)
- 075 Task 08 (Open)
- 075 Task 09 (Open)
- 075 Task 10 (Open)
- 075 Task 11 (Open)
- 075 Task 12 (Open)
- 075 Task 13 (Open)
- 075 Task 14 (Open)
- 075 Task 15 (Open)
- 075 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 075](/task/parent-075).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-075/subtasks --limit 850b >/dev/null
alpine update /task/parent-075/subtasks \\
  --old '- [075 Task 01 (Open)](/task/075-task-01)

- [075 Task 02 (Open)](/task/075-task-02)

- [075 Task 03 (Open)](/task/075-task-03)

- [075 Task 04 (Open)](/task/075-task-04)

- [075 Task 05 (Open)](/task/075-task-05)

- [075 Task 06 (Open)](/task/075-task-06)

- [075 Task 07 (Open)](/task/075-task-07)

- [075 Task 08 (Open)](/task/075-task-08)

- [075 Task 09 (Open)](/task/075-task-09)

- [075 Task 10 (Open)](/task/075-task-10)

- [075 Task 11 (Open)](/task/075-task-11)

- [075 Task 12 (Open)](/task/075-task-12)

- [075 Task 13 (Open)](/task/075-task-13)

- [075 Task 14 (Open)](/task/075-task-14)

- [075 Task 15 (Open)](/task/075-task-15)' \\
  --new '- [075 Task 01 (Open)](/task/075-task-01)

- [075 Task 03 (Open)](/task/075-task-03)

- [075 Task 04 (Open)](/task/075-task-04)

- [075 Task 05 (Open)](/task/075-task-05)

- [075 Task 06 (Open)](/task/075-task-06)

- 075 Condition new 1 (Open)

- [075 Task 07 (Open)](/task/075-task-07)

- [075 Task 08 (Open)](/task/075-task-08)

- [075 Task 09 (Open)](/task/075-task-09)

- 075 Condition new 2 (Open)

- [075 Task 10 (Open)](/task/075-task-10)

- [075 Task 11 (Open)](/task/075-task-11)

- [075 Task 12 (Open)](/task/075-task-12)

- [075 Task 13 (Open)](/task/075-task-13)

- [075 Task 14 (Open)](/task/075-task-14)

- [075 Task 15 (Open)](/task/075-task-15)

- [075 Task 02 (Open)](/task/075-task-02)'
alpine read /task/parent-075/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 075 (Open)](/task/parent-075).

- [075 Task 01 (Open)](/task/075-task-01)

- [075 Task 03 (Open)](/task/075-task-03)

- [075 Task 04 (Open)](/task/075-task-04)

- [075 Task 05 (Open)](/task/075-task-05)

- [075 Task 06 (Open)](/task/075-task-06)

- [075 Condition new 1 (Open)](/task/075-condition-new-1)

- [075 Task 07 (Open)](/task/075-task-07)

- [075 Task 08 (Open)](/task/075-task-08)

- [075 Task 09 (Open)](/task/075-task-09)

- [075 Condition new 2 (Open)](/task/075-condition-new-2)

- [075 Task 10 (Open)](/task/075-task-10)

- [075 Task 11 (Open)](/task/075-task-11)

- [075 Task 12 (Open)](/task/075-task-12)

- [075 Task 13 (Open)](/task/075-task-13)

- [075 Task 14 (Open)](/task/075-task-14)

- [075 Task 15 (Open)](/task/075-task-15)

- [075 Task 02 (Open)](/task/075-task-02)

- [075 After pagination guard with a deliberately long title (Open)](/task/075-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task subtasks page tail that is not the end; one other task created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 076

## Subtasks

- 076 Before (Open)
- 076 Task 01 (Open)
- 076 Task 02 (Open)
- 076 Task 03 (Open)
- 076 Task 04 (Open)
- 076 Task 05 (Open)
- 076 Task 06 (Open)
- 076 Task 07 (Open)
- 076 Task 08 (Open)
- 076 Task 09 (Open)
- 076 Task 10 (Open)
- 076 Task 11 (Open)
- 076 Task 12 (Open)
- 076 Task 13 (Open)
- 076 Task 14 (Open)
- 076 Task 15 (Open)
- 076 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 076](/task/parent-076).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-076/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [076 Task 01 (Open)](/task/076-task-01)

- [076 Task 02 (Open)](/task/076-task-02)

- [076 Task 03 (Open)](/task/076-task-03)

- [076 Task 04 (Open)](/task/076-task-04)

- [076 Task 05 (Open)](/task/076-task-05)

- [076 Task 06 (Open)](/task/076-task-06)

- [076 Task 07 (Open)](/task/076-task-07)

- [076 Task 08 (Open)](/task/076-task-08)

- [076 Task 09 (Open)](/task/076-task-09)

- [076 Task 10 (Open)](/task/076-task-10)

- [076 Task 11 (Open)](/task/076-task-11)

- [076 Task 12 (Open)](/task/076-task-12)

- [076 Task 13 (Open)](/task/076-task-13)

- [076 Task 14 (Open)](/task/076-task-14)

- [076 Task 15 (Open)](/task/076-task-15)' \\
  --new '- [076 Task 01 (Open)](/task/076-task-01)

- [076 Task 02 (Open)](/task/076-task-02)

- [076 Task 03 (Open)](/task/076-task-03)

- [076 Task 04 (Open)](/task/076-task-04)

- [076 Task 05 (Open)](/task/076-task-05)

- [076 Task 06 (Open)](/task/076-task-06)

- [076 Task 07 (Open)](/task/076-task-07)

- 076 Condition previous 1 (Open)

- [076 Task 08 (Open)](/task/076-task-08)

- [076 Task 09 (Open)](/task/076-task-09)

- [076 Task 10 (Open)](/task/076-task-10)

- [076 Task 11 (Open)](/task/076-task-11)

- [076 Task 12 (Open)](/task/076-task-12)

- [076 Task 13 (Open)](/task/076-task-13)

- [076 Task 14 (Open)](/task/076-task-14)

- [076 Task 15 (Open)](/task/076-task-15)'
alpine update $path \\
  --old '- [076 Task 01 (Open)](/task/076-task-01)

- [076 Task 02 (Open)](/task/076-task-02)

- [076 Task 03 (Open)](/task/076-task-03)

- [076 Task 04 (Open)](/task/076-task-04)

- [076 Task 05 (Open)](/task/076-task-05)

- [076 Task 06 (Open)](/task/076-task-06)

- [076 Task 07 (Open)](/task/076-task-07)

- 076 Condition previous 1 (Open)

- [076 Task 08 (Open)](/task/076-task-08)

- [076 Task 09 (Open)](/task/076-task-09)

- [076 Task 10 (Open)](/task/076-task-10)

- [076 Task 11 (Open)](/task/076-task-11)

- [076 Task 12 (Open)](/task/076-task-12)

- [076 Task 13 (Open)](/task/076-task-13)

- [076 Task 14 (Open)](/task/076-task-14)

- [076 Task 15 (Open)](/task/076-task-15)' \\
  --new '- [076 Task 01 (Open)](/task/076-task-01)

- [076 Task 03 (Open)](/task/076-task-03)

- [076 Task 04 (Open)](/task/076-task-04)

- [076 Task 05 (Open)](/task/076-task-05)

- [076 Task 06 (Open)](/task/076-task-06)

- [076 Task 07 (Open)](/task/076-task-07)

- 076 Condition previous 1 (Open)

- [076 Task 08 (Open)](/task/076-task-08)

- [076 Task 09 (Open)](/task/076-task-09)

- [076 Task 10 (Open)](/task/076-task-10)

- [076 Task 11 (Open)](/task/076-task-11)

- [076 Task 12 (Open)](/task/076-task-12)

- [076 Task 13 (Open)](/task/076-task-13)

- [076 Task 14 (Open)](/task/076-task-14)

- [076 Task 15 (Open)](/task/076-task-15)

- [076 Task 02 (Open)](/task/076-task-02)'
alpine read /task/parent-076/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 076 (Open)](/task/parent-076).

- [076 Before (Open)](/task/076-before)

- [076 Task 01 (Open)](/task/076-task-01)

- [076 Task 03 (Open)](/task/076-task-03)

- [076 Task 04 (Open)](/task/076-task-04)

- [076 Task 05 (Open)](/task/076-task-05)

- [076 Task 06 (Open)](/task/076-task-06)

- [076 Task 07 (Open)](/task/076-task-07)

- [076 Condition previous 1 (Open)](/task/076-condition-previous-1)

- [076 Task 08 (Open)](/task/076-task-08)

- [076 Task 09 (Open)](/task/076-task-09)

- [076 Task 10 (Open)](/task/076-task-10)

- [076 Task 11 (Open)](/task/076-task-11)

- [076 Task 12 (Open)](/task/076-task-12)

- [076 Task 13 (Open)](/task/076-task-13)

- [076 Task 14 (Open)](/task/076-task-14)

- [076 Task 15 (Open)](/task/076-task-15)

- [076 Task 02 (Open)](/task/076-task-02)

- [076 After pagination guard with a deliberately long title (Open)](/task/076-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task subtasks page tail at the end; two other adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 077

## Subtasks

- 077 Before (Open)
- 077 Task 01 (Open)
- 077 Task 02 (Open)
- 077 Task 03 (Open)
- 077 Task 04 (Open)
- 077 Task 05 (Open)
- 077 Task 06 (Open)
- 077 Task 07 (Open)
- 077 Task 08 (Open)
- 077 Task 09 (Open)
- 077 Task 10 (Open)
- 077 Task 11 (Open)
- 077 Task 12 (Open)
- 077 Task 13 (Open)
- 077 Task 14 (Open)
- 077 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 077](/task/parent-077).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-077/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [077 Task 01 (Open)](/task/077-task-01)

- [077 Task 02 (Open)](/task/077-task-02)

- [077 Task 03 (Open)](/task/077-task-03)

- [077 Task 04 (Open)](/task/077-task-04)

- [077 Task 05 (Open)](/task/077-task-05)

- [077 Task 06 (Open)](/task/077-task-06)

- [077 Task 07 (Open)](/task/077-task-07)

- [077 Task 08 (Open)](/task/077-task-08)

- [077 Task 09 (Open)](/task/077-task-09)

- [077 Task 10 (Open)](/task/077-task-10)

- [077 Task 11 (Open)](/task/077-task-11)

- [077 Task 12 (Open)](/task/077-task-12)

- [077 Task 13 (Open)](/task/077-task-13)

- [077 Task 14 (Open)](/task/077-task-14)

- [077 Task 15 (Open)](/task/077-task-15)' \\
  --new '- [077 Task 01 (Open)](/task/077-task-01)

- [077 Task 02 (Open)](/task/077-task-02)

- [077 Task 03 (Open)](/task/077-task-03)

- [077 Task 04 (Open)](/task/077-task-04)

- [077 Task 05 (Open)](/task/077-task-05)

- [077 Task 06 (Open)](/task/077-task-06)

- [077 Task 07 (Open)](/task/077-task-07)

- 077 Condition previous 1 (Open)

- 077 Condition previous 2 (Open)

- [077 Task 08 (Open)](/task/077-task-08)

- [077 Task 09 (Open)](/task/077-task-09)

- [077 Task 10 (Open)](/task/077-task-10)

- [077 Task 11 (Open)](/task/077-task-11)

- [077 Task 12 (Open)](/task/077-task-12)

- [077 Task 13 (Open)](/task/077-task-13)

- [077 Task 14 (Open)](/task/077-task-14)

- [077 Task 15 (Open)](/task/077-task-15)'
alpine update $path \\
  --old '- [077 Task 01 (Open)](/task/077-task-01)

- [077 Task 02 (Open)](/task/077-task-02)

- [077 Task 03 (Open)](/task/077-task-03)

- [077 Task 04 (Open)](/task/077-task-04)

- [077 Task 05 (Open)](/task/077-task-05)

- [077 Task 06 (Open)](/task/077-task-06)

- [077 Task 07 (Open)](/task/077-task-07)

- 077 Condition previous 1 (Open)

- 077 Condition previous 2 (Open)

- [077 Task 08 (Open)](/task/077-task-08)

- [077 Task 09 (Open)](/task/077-task-09)

- [077 Task 10 (Open)](/task/077-task-10)

- [077 Task 11 (Open)](/task/077-task-11)

- [077 Task 12 (Open)](/task/077-task-12)

- [077 Task 13 (Open)](/task/077-task-13)

- [077 Task 14 (Open)](/task/077-task-14)

- [077 Task 15 (Open)](/task/077-task-15)' \\
  --new '- [077 Task 01 (Open)](/task/077-task-01)

- [077 Task 03 (Open)](/task/077-task-03)

- [077 Task 04 (Open)](/task/077-task-04)

- [077 Task 05 (Open)](/task/077-task-05)

- [077 Task 06 (Open)](/task/077-task-06)

- [077 Task 07 (Open)](/task/077-task-07)

- 077 Condition previous 1 (Open)

- 077 Condition previous 2 (Open)

- [077 Task 08 (Open)](/task/077-task-08)

- [077 Task 09 (Open)](/task/077-task-09)

- [077 Task 10 (Open)](/task/077-task-10)

- [077 Task 11 (Open)](/task/077-task-11)

- [077 Task 12 (Open)](/task/077-task-12)

- [077 Task 13 (Open)](/task/077-task-13)

- [077 Task 14 (Open)](/task/077-task-14)

- [077 Task 15 (Open)](/task/077-task-15)

- [077 Task 02 (Open)](/task/077-task-02)'
alpine read /task/parent-077/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 077 (Open)](/task/parent-077).

- [077 Before (Open)](/task/077-before)

- [077 Task 01 (Open)](/task/077-task-01)

- [077 Task 03 (Open)](/task/077-task-03)

- [077 Task 04 (Open)](/task/077-task-04)

- [077 Task 05 (Open)](/task/077-task-05)

- [077 Task 06 (Open)](/task/077-task-06)

- [077 Task 07 (Open)](/task/077-task-07)

- [077 Condition previous 1 (Open)](/task/077-condition-previous-1)

- [077 Condition previous 2 (Open)](/task/077-condition-previous-2)

- [077 Task 08 (Open)](/task/077-task-08)

- [077 Task 09 (Open)](/task/077-task-09)

- [077 Task 10 (Open)](/task/077-task-10)

- [077 Task 11 (Open)](/task/077-task-11)

- [077 Task 12 (Open)](/task/077-task-12)

- [077 Task 13 (Open)](/task/077-task-13)

- [077 Task 14 (Open)](/task/077-task-14)

- [077 Task 15 (Open)](/task/077-task-15)

- [077 Task 02 (Open)](/task/077-task-02)

End of tasks.
`);
});

test("one existing task to end; task collection page head; two other non-adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 078

- 078 Task 01 (Open)
- 078 Task 02 (Open)
- 078 Task 03 (Open)
- 078 Task 04 (Open)
- 078 Task 05 (Open)
- 078 Task 06 (Open)
- 078 Task 07 (Open)
- 078 Task 08 (Open)
- 078 Task 09 (Open)
- 078 Task 10 (Open)
- 078 Task 11 (Open)
- 078 Task 12 (Open)
- 078 Task 13 (Open)
- 078 Task 14 (Open)
- 078 Task 15 (Open)
- 078 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 078](/task-collection/roadmap-078).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-078 --limit 850b >/dev/null
alpine update /task-collection/roadmap-078 \\
  --old '- [078 Task 01 (Open)](/task/078-task-01)

- [078 Task 02 (Open)](/task/078-task-02)

- [078 Task 03 (Open)](/task/078-task-03)

- [078 Task 04 (Open)](/task/078-task-04)

- [078 Task 05 (Open)](/task/078-task-05)

- [078 Task 06 (Open)](/task/078-task-06)

- [078 Task 07 (Open)](/task/078-task-07)

- [078 Task 08 (Open)](/task/078-task-08)

- [078 Task 09 (Open)](/task/078-task-09)

- [078 Task 10 (Open)](/task/078-task-10)

- [078 Task 11 (Open)](/task/078-task-11)

- [078 Task 12 (Open)](/task/078-task-12)

- [078 Task 13 (Open)](/task/078-task-13)

- [078 Task 14 (Open)](/task/078-task-14)

- [078 Task 15 (Open)](/task/078-task-15)' \\
  --new '- [078 Task 01 (Open)](/task/078-task-01)

- [078 Task 02 (Open)](/task/078-task-02)

- [078 Task 03 (Open)](/task/078-task-03)

- [078 Task 04 (Open)](/task/078-task-04)

- [078 Task 05 (Open)](/task/078-task-05)

- [078 Task 06 (Open)](/task/078-task-06)

- 078 Condition previous 1 (Open)

- [078 Task 07 (Open)](/task/078-task-07)

- [078 Task 08 (Open)](/task/078-task-08)

- [078 Task 09 (Open)](/task/078-task-09)

- 078 Condition previous 2 (Open)

- [078 Task 10 (Open)](/task/078-task-10)

- [078 Task 11 (Open)](/task/078-task-11)

- [078 Task 12 (Open)](/task/078-task-12)

- [078 Task 13 (Open)](/task/078-task-13)

- [078 Task 14 (Open)](/task/078-task-14)

- [078 Task 15 (Open)](/task/078-task-15)'
alpine update /task-collection/roadmap-078 \\
  --old '- [078 Task 01 (Open)](/task/078-task-01)

- [078 Task 02 (Open)](/task/078-task-02)

- [078 Task 03 (Open)](/task/078-task-03)

- [078 Task 04 (Open)](/task/078-task-04)

- [078 Task 05 (Open)](/task/078-task-05)

- [078 Task 06 (Open)](/task/078-task-06)

- 078 Condition previous 1 (Open)

- [078 Task 07 (Open)](/task/078-task-07)

- [078 Task 08 (Open)](/task/078-task-08)

- [078 Task 09 (Open)](/task/078-task-09)

- 078 Condition previous 2 (Open)

- [078 Task 10 (Open)](/task/078-task-10)

- [078 Task 11 (Open)](/task/078-task-11)

- [078 Task 12 (Open)](/task/078-task-12)

- [078 Task 13 (Open)](/task/078-task-13)

- [078 Task 14 (Open)](/task/078-task-14)

- [078 Task 15 (Open)](/task/078-task-15)' \\
  --new '- [078 Task 01 (Open)](/task/078-task-01)

- [078 Task 03 (Open)](/task/078-task-03)

- [078 Task 04 (Open)](/task/078-task-04)

- [078 Task 05 (Open)](/task/078-task-05)

- [078 Task 06 (Open)](/task/078-task-06)

- 078 Condition previous 1 (Open)

- [078 Task 07 (Open)](/task/078-task-07)

- [078 Task 08 (Open)](/task/078-task-08)

- [078 Task 09 (Open)](/task/078-task-09)

- 078 Condition previous 2 (Open)

- [078 Task 10 (Open)](/task/078-task-10)

- [078 Task 11 (Open)](/task/078-task-11)

- [078 Task 12 (Open)](/task/078-task-12)

- [078 Task 13 (Open)](/task/078-task-13)

- [078 Task 14 (Open)](/task/078-task-14)

- [078 Task 15 (Open)](/task/078-task-15)

- [078 Task 02 (Open)](/task/078-task-02)'
alpine read /task-collection/roadmap-078 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 078

- [078 Task 01 (Open)](/task/078-task-01)

- [078 Task 03 (Open)](/task/078-task-03)

- [078 Task 04 (Open)](/task/078-task-04)

- [078 Task 05 (Open)](/task/078-task-05)

- [078 Task 06 (Open)](/task/078-task-06)

- [078 Condition previous 1 (Open)](/task/078-condition-previous-1)

- [078 Task 07 (Open)](/task/078-task-07)

- [078 Task 08 (Open)](/task/078-task-08)

- [078 Task 09 (Open)](/task/078-task-09)

- [078 Condition previous 2 (Open)](/task/078-condition-previous-2)

- [078 Task 10 (Open)](/task/078-task-10)

- [078 Task 11 (Open)](/task/078-task-11)

- [078 Task 12 (Open)](/task/078-task-12)

- [078 Task 13 (Open)](/task/078-task-13)

- [078 Task 14 (Open)](/task/078-task-14)

- [078 Task 15 (Open)](/task/078-task-15)

- [078 Task 02 (Open)](/task/078-task-02)

- [078 After pagination guard with a deliberately long title (Open)](/task/078-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task collection page tail that is not the end; one other existing task moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 079

- 079 Before (Open)
- 079 Task 01 (Open)
- 079 Task 02 (Open)
- 079 Task 03 (Open)
- 079 Task 04 (Open)
- 079 Task 05 (Open)
- 079 Task 06 (Open)
- 079 Task 07 (Open)
- 079 Task 08 (Open)
- 079 Task 09 (Open)
- 079 Task 10 (Open)
- 079 Task 11 (Open)
- 079 Task 12 (Open)
- 079 Task 13 (Open)
- 079 Task 14 (Open)
- 079 Task 15 (Open)
- 079 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 079](/task-collection/roadmap-079).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-079 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [079 Task 01 (Open)](/task/079-task-01)

- [079 Task 02 (Open)](/task/079-task-02)

- [079 Task 03 (Open)](/task/079-task-03)

- [079 Task 04 (Open)](/task/079-task-04)

- [079 Task 05 (Open)](/task/079-task-05)

- [079 Task 06 (Open)](/task/079-task-06)

- [079 Task 07 (Open)](/task/079-task-07)

- [079 Task 08 (Open)](/task/079-task-08)

- [079 Task 09 (Open)](/task/079-task-09)

- [079 Task 10 (Open)](/task/079-task-10)

- [079 Task 11 (Open)](/task/079-task-11)

- [079 Task 12 (Open)](/task/079-task-12)

- [079 Task 13 (Open)](/task/079-task-13)

- [079 Task 14 (Open)](/task/079-task-14)

- [079 Task 15 (Open)](/task/079-task-15)' \\
  --new '- [079 Task 01 (Open)](/task/079-task-01)

- [079 Task 03 (Open)](/task/079-task-03)

- [079 Task 04 (Open)](/task/079-task-04)

- [079 Task 05 (Open)](/task/079-task-05)

- [079 Task 06 (Open)](/task/079-task-06)

- [079 Task 07 (Open)](/task/079-task-07)

- [079 Task 09 (Open)](/task/079-task-09)

- [079 Task 10 (Open)](/task/079-task-10)

- [079 Task 08 (Open)](/task/079-task-08)

- [079 Task 11 (Open)](/task/079-task-11)

- [079 Task 12 (Open)](/task/079-task-12)

- [079 Task 13 (Open)](/task/079-task-13)

- [079 Task 14 (Open)](/task/079-task-14)

- [079 Task 15 (Open)](/task/079-task-15)

- [079 Task 02 (Open)](/task/079-task-02)'
alpine read /task-collection/roadmap-079 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 079

- [079 Before (Open)](/task/079-before)

- [079 Task 01 (Open)](/task/079-task-01)

- [079 Task 03 (Open)](/task/079-task-03)

- [079 Task 04 (Open)](/task/079-task-04)

- [079 Task 05 (Open)](/task/079-task-05)

- [079 Task 06 (Open)](/task/079-task-06)

- [079 Task 07 (Open)](/task/079-task-07)

- [079 Task 09 (Open)](/task/079-task-09)

- [079 Task 10 (Open)](/task/079-task-10)

- [079 Task 08 (Open)](/task/079-task-08)

- [079 Task 11 (Open)](/task/079-task-11)

- [079 Task 12 (Open)](/task/079-task-12)

- [079 Task 13 (Open)](/task/079-task-13)

- [079 Task 14 (Open)](/task/079-task-14)

- [079 Task 15 (Open)](/task/079-task-15)

- [079 Task 02 (Open)](/task/079-task-02)

- [079 After pagination guard with a deliberately long title (Open)](/task/079-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to end; task collection page tail at the end; two other existing tasks swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 080

- 080 Before (Open)
- 080 Task 01 (Open)
- 080 Task 02 (Open)
- 080 Task 03 (Open)
- 080 Task 04 (Open)
- 080 Task 05 (Open)
- 080 Task 06 (Open)
- 080 Task 07 (Open)
- 080 Task 08 (Open)
- 080 Task 09 (Open)
- 080 Task 10 (Open)
- 080 Task 11 (Open)
- 080 Task 12 (Open)
- 080 Task 13 (Open)
- 080 Task 14 (Open)
- 080 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 080](/task-collection/roadmap-080).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-080 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [080 Task 01 (Open)](/task/080-task-01)

- [080 Task 02 (Open)](/task/080-task-02)

- [080 Task 03 (Open)](/task/080-task-03)

- [080 Task 04 (Open)](/task/080-task-04)

- [080 Task 05 (Open)](/task/080-task-05)

- [080 Task 06 (Open)](/task/080-task-06)

- [080 Task 07 (Open)](/task/080-task-07)

- [080 Task 08 (Open)](/task/080-task-08)

- [080 Task 09 (Open)](/task/080-task-09)

- [080 Task 10 (Open)](/task/080-task-10)

- [080 Task 11 (Open)](/task/080-task-11)

- [080 Task 12 (Open)](/task/080-task-12)

- [080 Task 13 (Open)](/task/080-task-13)

- [080 Task 14 (Open)](/task/080-task-14)

- [080 Task 15 (Open)](/task/080-task-15)' \\
  --new '- [080 Task 01 (Open)](/task/080-task-01)

- [080 Task 03 (Open)](/task/080-task-03)

- [080 Task 04 (Open)](/task/080-task-04)

- [080 Task 05 (Open)](/task/080-task-05)

- [080 Task 06 (Open)](/task/080-task-06)

- [080 Task 09 (Open)](/task/080-task-09)

- [080 Task 08 (Open)](/task/080-task-08)

- [080 Task 07 (Open)](/task/080-task-07)

- [080 Task 10 (Open)](/task/080-task-10)

- [080 Task 11 (Open)](/task/080-task-11)

- [080 Task 12 (Open)](/task/080-task-12)

- [080 Task 13 (Open)](/task/080-task-13)

- [080 Task 14 (Open)](/task/080-task-14)

- [080 Task 15 (Open)](/task/080-task-15)

- [080 Task 02 (Open)](/task/080-task-02)'
alpine read /task-collection/roadmap-080 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 080

- [080 Before (Open)](/task/080-before)

- [080 Task 01 (Open)](/task/080-task-01)

- [080 Task 03 (Open)](/task/080-task-03)

- [080 Task 04 (Open)](/task/080-task-04)

- [080 Task 05 (Open)](/task/080-task-05)

- [080 Task 06 (Open)](/task/080-task-06)

- [080 Task 09 (Open)](/task/080-task-09)

- [080 Task 08 (Open)](/task/080-task-08)

- [080 Task 07 (Open)](/task/080-task-07)

- [080 Task 10 (Open)](/task/080-task-10)

- [080 Task 11 (Open)](/task/080-task-11)

- [080 Task 12 (Open)](/task/080-task-12)

- [080 Task 13 (Open)](/task/080-task-13)

- [080 Task 14 (Open)](/task/080-task-14)

- [080 Task 15 (Open)](/task/080-task-15)

- [080 Task 02 (Open)](/task/080-task-02)

End of tasks.
`);
});

test("one existing task to end; task page subtasks list; one other link-less task from the previous update moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 081

## Subtasks

- 081 Task 01 (Open)
- 081 Task 02 (Open)
- 081 Task 03 (Open)
- 081 Task 04 (Open)
- 081 Task 05 (Open)
- 081 Task 06 (Open)
- 081 Task 07 (Open)
- 081 Task 08 (Open)
- 081 Task 09 (Open)
- 081 Task 10 (Open)
- 081 Task 11 (Open)
- 081 Task 12 (Open)
- 081 Task 13 (Open)
- 081 Task 14 (Open)
- 081 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 081](/task/parent-081).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-081 --limit 100kb >/dev/null
alpine update /task/parent-081 \\
  --old '- [081 Task 01 (Open)](/task/081-task-01)

- [081 Task 02 (Open)](/task/081-task-02)

- [081 Task 03 (Open)](/task/081-task-03)

- [081 Task 04 (Open)](/task/081-task-04)

- [081 Task 05 (Open)](/task/081-task-05)

- [081 Task 06 (Open)](/task/081-task-06)

- [081 Task 07 (Open)](/task/081-task-07)

- [081 Task 08 (Open)](/task/081-task-08)

- [081 Task 09 (Open)](/task/081-task-09)

- [081 Task 10 (Open)](/task/081-task-10)

- [081 Task 11 (Open)](/task/081-task-11)

- [081 Task 12 (Open)](/task/081-task-12)

- [081 Task 13 (Open)](/task/081-task-13)

- [081 Task 14 (Open)](/task/081-task-14)

- [081 Task 15 (Open)](/task/081-task-15)' \\
  --new '- [081 Task 01 (Open)](/task/081-task-01)

- [081 Task 02 (Open)](/task/081-task-02)

- [081 Task 03 (Open)](/task/081-task-03)

- [081 Task 04 (Open)](/task/081-task-04)

- [081 Task 05 (Open)](/task/081-task-05)

- [081 Task 06 (Open)](/task/081-task-06)

- [081 Task 07 (Open)](/task/081-task-07)

- 081 Condition previous 1 (Open)

- [081 Task 08 (Open)](/task/081-task-08)

- [081 Task 09 (Open)](/task/081-task-09)

- [081 Task 10 (Open)](/task/081-task-10)

- [081 Task 11 (Open)](/task/081-task-11)

- [081 Task 12 (Open)](/task/081-task-12)

- [081 Task 13 (Open)](/task/081-task-13)

- [081 Task 14 (Open)](/task/081-task-14)

- [081 Task 15 (Open)](/task/081-task-15)'
alpine update /task/parent-081 \\
  --old '- [081 Task 01 (Open)](/task/081-task-01)

- [081 Task 02 (Open)](/task/081-task-02)

- [081 Task 03 (Open)](/task/081-task-03)

- [081 Task 04 (Open)](/task/081-task-04)

- [081 Task 05 (Open)](/task/081-task-05)

- [081 Task 06 (Open)](/task/081-task-06)

- [081 Task 07 (Open)](/task/081-task-07)

- 081 Condition previous 1 (Open)

- [081 Task 08 (Open)](/task/081-task-08)

- [081 Task 09 (Open)](/task/081-task-09)

- [081 Task 10 (Open)](/task/081-task-10)

- [081 Task 11 (Open)](/task/081-task-11)

- [081 Task 12 (Open)](/task/081-task-12)

- [081 Task 13 (Open)](/task/081-task-13)

- [081 Task 14 (Open)](/task/081-task-14)

- [081 Task 15 (Open)](/task/081-task-15)' \\
  --new '- [081 Task 01 (Open)](/task/081-task-01)

- [081 Task 03 (Open)](/task/081-task-03)

- [081 Task 04 (Open)](/task/081-task-04)

- [081 Task 05 (Open)](/task/081-task-05)

- [081 Task 06 (Open)](/task/081-task-06)

- [081 Task 07 (Open)](/task/081-task-07)

- [081 Task 08 (Open)](/task/081-task-08)

- [081 Task 09 (Open)](/task/081-task-09)

- [081 Task 10 (Open)](/task/081-task-10)

- 081 Condition previous 1 (Open)

- [081 Task 11 (Open)](/task/081-task-11)

- [081 Task 12 (Open)](/task/081-task-12)

- [081 Task 13 (Open)](/task/081-task-13)

- [081 Task 14 (Open)](/task/081-task-14)

- [081 Task 15 (Open)](/task/081-task-15)

- [081 Task 02 (Open)](/task/081-task-02)'
alpine read /task/parent-081 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 081

- Status: Open

## Subtasks

- [081 Task 01 (Open)](/task/081-task-01)

- [081 Task 03 (Open)](/task/081-task-03)

- [081 Task 04 (Open)](/task/081-task-04)

- [081 Task 05 (Open)](/task/081-task-05)

- [081 Task 06 (Open)](/task/081-task-06)

- [081 Task 07 (Open)](/task/081-task-07)

- [081 Task 08 (Open)](/task/081-task-08)

- [081 Task 09 (Open)](/task/081-task-09)

- [081 Task 10 (Open)](/task/081-task-10)

- [081 Condition previous 1 (Open)](/task/081-condition-previous-1)

- [081 Task 11 (Open)](/task/081-task-11)

- [081 Task 12 (Open)](/task/081-task-12)

- [081 Task 13 (Open)](/task/081-task-13)

- [081 Task 14 (Open)](/task/081-task-14)

- [081 Task 15 (Open)](/task/081-task-15)

- [081 Task 02 (Open)](/task/081-task-02)
`);
});

test("one existing task to end; task subtasks page head; two other link-less tasks from the previous update swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 082

## Subtasks

- 082 Task 01 (Open)
- 082 Task 02 (Open)
- 082 Task 03 (Open)
- 082 Task 04 (Open)
- 082 Task 05 (Open)
- 082 Task 06 (Open)
- 082 Task 07 (Open)
- 082 Task 08 (Open)
- 082 Task 09 (Open)
- 082 Task 10 (Open)
- 082 Task 11 (Open)
- 082 Task 12 (Open)
- 082 Task 13 (Open)
- 082 Task 14 (Open)
- 082 Task 15 (Open)
- 082 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 082](/task/parent-082).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-082/subtasks --limit 850b >/dev/null
alpine update /task/parent-082/subtasks \\
  --old '- [082 Task 01 (Open)](/task/082-task-01)

- [082 Task 02 (Open)](/task/082-task-02)

- [082 Task 03 (Open)](/task/082-task-03)

- [082 Task 04 (Open)](/task/082-task-04)

- [082 Task 05 (Open)](/task/082-task-05)

- [082 Task 06 (Open)](/task/082-task-06)

- [082 Task 07 (Open)](/task/082-task-07)

- [082 Task 08 (Open)](/task/082-task-08)

- [082 Task 09 (Open)](/task/082-task-09)

- [082 Task 10 (Open)](/task/082-task-10)

- [082 Task 11 (Open)](/task/082-task-11)

- [082 Task 12 (Open)](/task/082-task-12)

- [082 Task 13 (Open)](/task/082-task-13)

- [082 Task 14 (Open)](/task/082-task-14)

- [082 Task 15 (Open)](/task/082-task-15)' \\
  --new '- [082 Task 01 (Open)](/task/082-task-01)

- [082 Task 02 (Open)](/task/082-task-02)

- [082 Task 03 (Open)](/task/082-task-03)

- [082 Task 04 (Open)](/task/082-task-04)

- [082 Task 05 (Open)](/task/082-task-05)

- [082 Task 06 (Open)](/task/082-task-06)

- 082 Condition previous 1 (Open)

- [082 Task 07 (Open)](/task/082-task-07)

- [082 Task 08 (Open)](/task/082-task-08)

- [082 Task 09 (Open)](/task/082-task-09)

- 082 Condition previous 2 (Open)

- [082 Task 10 (Open)](/task/082-task-10)

- [082 Task 11 (Open)](/task/082-task-11)

- [082 Task 12 (Open)](/task/082-task-12)

- [082 Task 13 (Open)](/task/082-task-13)

- [082 Task 14 (Open)](/task/082-task-14)

- [082 Task 15 (Open)](/task/082-task-15)'
alpine update /task/parent-082/subtasks \\
  --old '- [082 Task 01 (Open)](/task/082-task-01)

- [082 Task 02 (Open)](/task/082-task-02)

- [082 Task 03 (Open)](/task/082-task-03)

- [082 Task 04 (Open)](/task/082-task-04)

- [082 Task 05 (Open)](/task/082-task-05)

- [082 Task 06 (Open)](/task/082-task-06)

- 082 Condition previous 1 (Open)

- [082 Task 07 (Open)](/task/082-task-07)

- [082 Task 08 (Open)](/task/082-task-08)

- [082 Task 09 (Open)](/task/082-task-09)

- 082 Condition previous 2 (Open)

- [082 Task 10 (Open)](/task/082-task-10)

- [082 Task 11 (Open)](/task/082-task-11)

- [082 Task 12 (Open)](/task/082-task-12)

- [082 Task 13 (Open)](/task/082-task-13)

- [082 Task 14 (Open)](/task/082-task-14)

- [082 Task 15 (Open)](/task/082-task-15)' \\
  --new '- [082 Task 01 (Open)](/task/082-task-01)

- [082 Task 03 (Open)](/task/082-task-03)

- [082 Task 04 (Open)](/task/082-task-04)

- [082 Task 05 (Open)](/task/082-task-05)

- [082 Task 06 (Open)](/task/082-task-06)

- 082 Condition previous 2 (Open)

- [082 Task 07 (Open)](/task/082-task-07)

- [082 Task 08 (Open)](/task/082-task-08)

- [082 Task 09 (Open)](/task/082-task-09)

- 082 Condition previous 1 (Open)

- [082 Task 10 (Open)](/task/082-task-10)

- [082 Task 11 (Open)](/task/082-task-11)

- [082 Task 12 (Open)](/task/082-task-12)

- [082 Task 13 (Open)](/task/082-task-13)

- [082 Task 14 (Open)](/task/082-task-14)

- [082 Task 15 (Open)](/task/082-task-15)

- [082 Task 02 (Open)](/task/082-task-02)'
alpine read /task/parent-082/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 082 (Open)](/task/parent-082).

- [082 Task 01 (Open)](/task/082-task-01)

- [082 Task 03 (Open)](/task/082-task-03)

- [082 Task 04 (Open)](/task/082-task-04)

- [082 Task 05 (Open)](/task/082-task-05)

- [082 Task 06 (Open)](/task/082-task-06)

- [082 Condition previous 2 (Open)](/task/082-condition-previous-2)

- [082 Task 07 (Open)](/task/082-task-07)

- [082 Task 08 (Open)](/task/082-task-08)

- [082 Task 09 (Open)](/task/082-task-09)

- [082 Condition previous 1 (Open)](/task/082-condition-previous-1)

- [082 Task 10 (Open)](/task/082-task-10)

- [082 Task 11 (Open)](/task/082-task-11)

- [082 Task 12 (Open)](/task/082-task-12)

- [082 Task 13 (Open)](/task/082-task-13)

- [082 Task 14 (Open)](/task/082-task-14)

- [082 Task 15 (Open)](/task/082-task-15)

- [082 Task 02 (Open)](/task/082-task-02)

- [082 After pagination guard with a deliberately long title (Open)](/task/082-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task subtasks page tail that is not the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 083

## Subtasks

- 083 Before (Open)
- 083 Task 01 (Open)
- 083 Task 02 (Open)
- 083 Task 03 (Open)
- 083 Task 04 (Open)
- 083 Task 05 (Open)
- 083 Task 06 (Open)
- 083 Task 07 (Open)
- 083 Task 08 (Open)
- 083 Task 09 (Open)
- 083 Task 10 (Open)
- 083 Task 11 (Open)
- 083 Task 12 (Open)
- 083 Task 13 (Open)
- 083 Task 14 (Open)
- 083 Task 15 (Open)
- 083 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 083](/task/parent-083).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-083/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [083 Task 01 (Open)](/task/083-task-01)

- [083 Task 02 (Open)](/task/083-task-02)

- [083 Task 03 (Open)](/task/083-task-03)

- [083 Task 04 (Open)](/task/083-task-04)

- [083 Task 05 (Open)](/task/083-task-05)

- [083 Task 06 (Open)](/task/083-task-06)

- [083 Task 07 (Open)](/task/083-task-07)

- [083 Task 08 (Open)](/task/083-task-08)

- [083 Task 09 (Open)](/task/083-task-09)

- [083 Task 10 (Open)](/task/083-task-10)

- [083 Task 11 (Open)](/task/083-task-11)

- [083 Task 12 (Open)](/task/083-task-12)

- [083 Task 13 (Open)](/task/083-task-13)

- [083 Task 14 (Open)](/task/083-task-14)

- [083 Task 15 (Open)](/task/083-task-15)' \\
  --new '- [083 Task 01 (Open)](/task/083-task-01)

- [083 Task 03 (Open)](/task/083-task-03)

- [083 Task 04 (Open)](/task/083-task-04)

- [083 Task 05 (Open)](/task/083-task-05)

- [083 Task 06 (Open)](/task/083-task-06)

- [083 Task 07 (Open)](/task/083-task-07)

- [083 Task 08 (Open)](/task/083-task-08)

- [083 Task 09 (Open)](/task/083-task-09)

- [083 Task 10 (Open)](/task/083-task-10)

- [083 Task 11 (Open)](/task/083-task-11)

- [083 Task 12 (Open)](/task/083-task-12)

- [083 Task 02 (Open)](/task/083-task-02)

- [083 Task 13 (Open)](/task/083-task-13)

- [083 Task 14 (Open)](/task/083-task-14)

- [083 Task 15 (Open)](/task/083-task-15)'
alpine read /task/parent-083/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 083 (Open)](/task/parent-083).

- [083 Before (Open)](/task/083-before)

- [083 Task 01 (Open)](/task/083-task-01)

- [083 Task 03 (Open)](/task/083-task-03)

- [083 Task 04 (Open)](/task/083-task-04)

- [083 Task 05 (Open)](/task/083-task-05)

- [083 Task 06 (Open)](/task/083-task-06)

- [083 Task 07 (Open)](/task/083-task-07)

- [083 Task 08 (Open)](/task/083-task-08)

- [083 Task 09 (Open)](/task/083-task-09)

- [083 Task 10 (Open)](/task/083-task-10)

- [083 Task 11 (Open)](/task/083-task-11)

- [083 Task 12 (Open)](/task/083-task-12)

- [083 Task 02 (Open)](/task/083-task-02)

- [083 Task 13 (Open)](/task/083-task-13)

- [083 Task 14 (Open)](/task/083-task-14)

- [083 Task 15 (Open)](/task/083-task-15)

- [083 After pagination guard with a deliberately long title (Open)](/task/083-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task subtasks page tail at the end; one other task created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 084

## Subtasks

- 084 Before (Open)
- 084 Task 01 (Open)
- 084 Task 02 (Open)
- 084 Task 03 (Open)
- 084 Task 04 (Open)
- 084 Task 05 (Open)
- 084 Task 06 (Open)
- 084 Task 07 (Open)
- 084 Task 08 (Open)
- 084 Task 09 (Open)
- 084 Task 10 (Open)
- 084 Task 11 (Open)
- 084 Task 12 (Open)
- 084 Task 13 (Open)
- 084 Task 14 (Open)
- 084 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 084](/task/parent-084).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-084/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [084 Task 01 (Open)](/task/084-task-01)

- [084 Task 02 (Open)](/task/084-task-02)

- [084 Task 03 (Open)](/task/084-task-03)

- [084 Task 04 (Open)](/task/084-task-04)

- [084 Task 05 (Open)](/task/084-task-05)

- [084 Task 06 (Open)](/task/084-task-06)

- [084 Task 07 (Open)](/task/084-task-07)

- [084 Task 08 (Open)](/task/084-task-08)

- [084 Task 09 (Open)](/task/084-task-09)

- [084 Task 10 (Open)](/task/084-task-10)

- [084 Task 11 (Open)](/task/084-task-11)

- [084 Task 12 (Open)](/task/084-task-12)

- [084 Task 13 (Open)](/task/084-task-13)

- [084 Task 14 (Open)](/task/084-task-14)

- [084 Task 15 (Open)](/task/084-task-15)' \\
  --new '- [084 Task 01 (Open)](/task/084-task-01)

- [084 Task 03 (Open)](/task/084-task-03)

- [084 Task 04 (Open)](/task/084-task-04)

- [084 Task 05 (Open)](/task/084-task-05)

- [084 Task 06 (Open)](/task/084-task-06)

- [084 Task 07 (Open)](/task/084-task-07)

- 084 Condition new 1 (Open)

- [084 Task 08 (Open)](/task/084-task-08)

- [084 Task 09 (Open)](/task/084-task-09)

- [084 Task 10 (Open)](/task/084-task-10)

- [084 Task 11 (Open)](/task/084-task-11)

- [084 Task 12 (Open)](/task/084-task-12)

- [084 Task 02 (Open)](/task/084-task-02)

- [084 Task 13 (Open)](/task/084-task-13)

- [084 Task 14 (Open)](/task/084-task-14)

- [084 Task 15 (Open)](/task/084-task-15)'
alpine read /task/parent-084/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 084 (Open)](/task/parent-084).

- [084 Before (Open)](/task/084-before)

- [084 Task 01 (Open)](/task/084-task-01)

- [084 Task 03 (Open)](/task/084-task-03)

- [084 Task 04 (Open)](/task/084-task-04)

- [084 Task 05 (Open)](/task/084-task-05)

- [084 Task 06 (Open)](/task/084-task-06)

- [084 Task 07 (Open)](/task/084-task-07)

- [084 Condition new 1 (Open)](/task/084-condition-new-1)

- [084 Task 08 (Open)](/task/084-task-08)

- [084 Task 09 (Open)](/task/084-task-09)

- [084 Task 10 (Open)](/task/084-task-10)

- [084 Task 11 (Open)](/task/084-task-11)

- [084 Task 12 (Open)](/task/084-task-12)

- [084 Task 02 (Open)](/task/084-task-02)

- [084 Task 13 (Open)](/task/084-task-13)

- [084 Task 14 (Open)](/task/084-task-14)

- [084 Task 15 (Open)](/task/084-task-15)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page head; two other adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 085

- 085 Task 01 (Open)
- 085 Task 02 (Open)
- 085 Task 03 (Open)
- 085 Task 04 (Open)
- 085 Task 05 (Open)
- 085 Task 06 (Open)
- 085 Task 07 (Open)
- 085 Task 08 (Open)
- 085 Task 09 (Open)
- 085 Task 10 (Open)
- 085 Task 11 (Open)
- 085 Task 12 (Open)
- 085 Task 13 (Open)
- 085 Task 14 (Open)
- 085 Task 15 (Open)
- 085 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 085](/task-collection/roadmap-085).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-085 --limit 850b >/dev/null
alpine update /task-collection/roadmap-085 \\
  --old '- [085 Task 01 (Open)](/task/085-task-01)

- [085 Task 02 (Open)](/task/085-task-02)

- [085 Task 03 (Open)](/task/085-task-03)

- [085 Task 04 (Open)](/task/085-task-04)

- [085 Task 05 (Open)](/task/085-task-05)

- [085 Task 06 (Open)](/task/085-task-06)

- [085 Task 07 (Open)](/task/085-task-07)

- [085 Task 08 (Open)](/task/085-task-08)

- [085 Task 09 (Open)](/task/085-task-09)

- [085 Task 10 (Open)](/task/085-task-10)

- [085 Task 11 (Open)](/task/085-task-11)

- [085 Task 12 (Open)](/task/085-task-12)

- [085 Task 13 (Open)](/task/085-task-13)

- [085 Task 14 (Open)](/task/085-task-14)

- [085 Task 15 (Open)](/task/085-task-15)' \\
  --new '- [085 Task 01 (Open)](/task/085-task-01)

- [085 Task 03 (Open)](/task/085-task-03)

- [085 Task 04 (Open)](/task/085-task-04)

- [085 Task 05 (Open)](/task/085-task-05)

- [085 Task 06 (Open)](/task/085-task-06)

- [085 Task 07 (Open)](/task/085-task-07)

- 085 Condition new 1 (Open)

- 085 Condition new 2 (Open)

- [085 Task 08 (Open)](/task/085-task-08)

- [085 Task 09 (Open)](/task/085-task-09)

- [085 Task 10 (Open)](/task/085-task-10)

- [085 Task 11 (Open)](/task/085-task-11)

- [085 Task 12 (Open)](/task/085-task-12)

- [085 Task 02 (Open)](/task/085-task-02)

- [085 Task 13 (Open)](/task/085-task-13)

- [085 Task 14 (Open)](/task/085-task-14)

- [085 Task 15 (Open)](/task/085-task-15)'
alpine read /task-collection/roadmap-085 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 085

- [085 Task 01 (Open)](/task/085-task-01)

- [085 Task 03 (Open)](/task/085-task-03)

- [085 Task 04 (Open)](/task/085-task-04)

- [085 Task 05 (Open)](/task/085-task-05)

- [085 Task 06 (Open)](/task/085-task-06)

- [085 Task 07 (Open)](/task/085-task-07)

- [085 Condition new 1 (Open)](/task/085-condition-new-1)

- [085 Condition new 2 (Open)](/task/085-condition-new-2)

- [085 Task 08 (Open)](/task/085-task-08)

- [085 Task 09 (Open)](/task/085-task-09)

- [085 Task 10 (Open)](/task/085-task-10)

- [085 Task 11 (Open)](/task/085-task-11)

- [085 Task 12 (Open)](/task/085-task-12)

- [085 Task 02 (Open)](/task/085-task-02)

- [085 Task 13 (Open)](/task/085-task-13)

- [085 Task 14 (Open)](/task/085-task-14)

- [085 Task 15 (Open)](/task/085-task-15)

- [085 After pagination guard with a deliberately long title (Open)](/task/085-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page tail that is not the end; two other non-adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 086

- 086 Before (Open)
- 086 Task 01 (Open)
- 086 Task 02 (Open)
- 086 Task 03 (Open)
- 086 Task 04 (Open)
- 086 Task 05 (Open)
- 086 Task 06 (Open)
- 086 Task 07 (Open)
- 086 Task 08 (Open)
- 086 Task 09 (Open)
- 086 Task 10 (Open)
- 086 Task 11 (Open)
- 086 Task 12 (Open)
- 086 Task 13 (Open)
- 086 Task 14 (Open)
- 086 Task 15 (Open)
- 086 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 086](/task-collection/roadmap-086).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-086 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [086 Task 01 (Open)](/task/086-task-01)

- [086 Task 02 (Open)](/task/086-task-02)

- [086 Task 03 (Open)](/task/086-task-03)

- [086 Task 04 (Open)](/task/086-task-04)

- [086 Task 05 (Open)](/task/086-task-05)

- [086 Task 06 (Open)](/task/086-task-06)

- [086 Task 07 (Open)](/task/086-task-07)

- [086 Task 08 (Open)](/task/086-task-08)

- [086 Task 09 (Open)](/task/086-task-09)

- [086 Task 10 (Open)](/task/086-task-10)

- [086 Task 11 (Open)](/task/086-task-11)

- [086 Task 12 (Open)](/task/086-task-12)

- [086 Task 13 (Open)](/task/086-task-13)

- [086 Task 14 (Open)](/task/086-task-14)

- [086 Task 15 (Open)](/task/086-task-15)' \\
  --new '- [086 Task 01 (Open)](/task/086-task-01)

- [086 Task 03 (Open)](/task/086-task-03)

- [086 Task 04 (Open)](/task/086-task-04)

- [086 Task 05 (Open)](/task/086-task-05)

- [086 Task 06 (Open)](/task/086-task-06)

- 086 Condition new 1 (Open)

- [086 Task 07 (Open)](/task/086-task-07)

- [086 Task 08 (Open)](/task/086-task-08)

- [086 Task 09 (Open)](/task/086-task-09)

- 086 Condition new 2 (Open)

- [086 Task 10 (Open)](/task/086-task-10)

- [086 Task 11 (Open)](/task/086-task-11)

- [086 Task 12 (Open)](/task/086-task-12)

- [086 Task 02 (Open)](/task/086-task-02)

- [086 Task 13 (Open)](/task/086-task-13)

- [086 Task 14 (Open)](/task/086-task-14)

- [086 Task 15 (Open)](/task/086-task-15)'
alpine read /task-collection/roadmap-086 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 086

- [086 Before (Open)](/task/086-before)

- [086 Task 01 (Open)](/task/086-task-01)

- [086 Task 03 (Open)](/task/086-task-03)

- [086 Task 04 (Open)](/task/086-task-04)

- [086 Task 05 (Open)](/task/086-task-05)

- [086 Task 06 (Open)](/task/086-task-06)

- [086 Condition new 1 (Open)](/task/086-condition-new-1)

- [086 Task 07 (Open)](/task/086-task-07)

- [086 Task 08 (Open)](/task/086-task-08)

- [086 Task 09 (Open)](/task/086-task-09)

- [086 Condition new 2 (Open)](/task/086-condition-new-2)

- [086 Task 10 (Open)](/task/086-task-10)

- [086 Task 11 (Open)](/task/086-task-11)

- [086 Task 12 (Open)](/task/086-task-12)

- [086 Task 02 (Open)](/task/086-task-02)

- [086 Task 13 (Open)](/task/086-task-13)

- [086 Task 14 (Open)](/task/086-task-14)

- [086 Task 15 (Open)](/task/086-task-15)

- [086 After pagination guard with a deliberately long title (Open)](/task/086-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page tail at the end; one other task created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 087

- 087 Before (Open)
- 087 Task 01 (Open)
- 087 Task 02 (Open)
- 087 Task 03 (Open)
- 087 Task 04 (Open)
- 087 Task 05 (Open)
- 087 Task 06 (Open)
- 087 Task 07 (Open)
- 087 Task 08 (Open)
- 087 Task 09 (Open)
- 087 Task 10 (Open)
- 087 Task 11 (Open)
- 087 Task 12 (Open)
- 087 Task 13 (Open)
- 087 Task 14 (Open)
- 087 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 087](/task-collection/roadmap-087).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-087 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [087 Task 01 (Open)](/task/087-task-01)

- [087 Task 02 (Open)](/task/087-task-02)

- [087 Task 03 (Open)](/task/087-task-03)

- [087 Task 04 (Open)](/task/087-task-04)

- [087 Task 05 (Open)](/task/087-task-05)

- [087 Task 06 (Open)](/task/087-task-06)

- [087 Task 07 (Open)](/task/087-task-07)

- [087 Task 08 (Open)](/task/087-task-08)

- [087 Task 09 (Open)](/task/087-task-09)

- [087 Task 10 (Open)](/task/087-task-10)

- [087 Task 11 (Open)](/task/087-task-11)

- [087 Task 12 (Open)](/task/087-task-12)

- [087 Task 13 (Open)](/task/087-task-13)

- [087 Task 14 (Open)](/task/087-task-14)

- [087 Task 15 (Open)](/task/087-task-15)' \\
  --new '- [087 Task 01 (Open)](/task/087-task-01)

- [087 Task 02 (Open)](/task/087-task-02)

- [087 Task 03 (Open)](/task/087-task-03)

- [087 Task 04 (Open)](/task/087-task-04)

- [087 Task 05 (Open)](/task/087-task-05)

- [087 Task 06 (Open)](/task/087-task-06)

- [087 Task 07 (Open)](/task/087-task-07)

- 087 Condition previous 1 (Open)

- [087 Task 08 (Open)](/task/087-task-08)

- [087 Task 09 (Open)](/task/087-task-09)

- [087 Task 10 (Open)](/task/087-task-10)

- [087 Task 11 (Open)](/task/087-task-11)

- [087 Task 12 (Open)](/task/087-task-12)

- [087 Task 13 (Open)](/task/087-task-13)

- [087 Task 14 (Open)](/task/087-task-14)

- [087 Task 15 (Open)](/task/087-task-15)'
alpine update $path \\
  --old '- [087 Task 01 (Open)](/task/087-task-01)

- [087 Task 02 (Open)](/task/087-task-02)

- [087 Task 03 (Open)](/task/087-task-03)

- [087 Task 04 (Open)](/task/087-task-04)

- [087 Task 05 (Open)](/task/087-task-05)

- [087 Task 06 (Open)](/task/087-task-06)

- [087 Task 07 (Open)](/task/087-task-07)

- 087 Condition previous 1 (Open)

- [087 Task 08 (Open)](/task/087-task-08)

- [087 Task 09 (Open)](/task/087-task-09)

- [087 Task 10 (Open)](/task/087-task-10)

- [087 Task 11 (Open)](/task/087-task-11)

- [087 Task 12 (Open)](/task/087-task-12)

- [087 Task 13 (Open)](/task/087-task-13)

- [087 Task 14 (Open)](/task/087-task-14)

- [087 Task 15 (Open)](/task/087-task-15)' \\
  --new '- [087 Task 01 (Open)](/task/087-task-01)

- [087 Task 03 (Open)](/task/087-task-03)

- [087 Task 04 (Open)](/task/087-task-04)

- [087 Task 05 (Open)](/task/087-task-05)

- [087 Task 06 (Open)](/task/087-task-06)

- [087 Task 07 (Open)](/task/087-task-07)

- 087 Condition previous 1 (Open)

- [087 Task 08 (Open)](/task/087-task-08)

- [087 Task 09 (Open)](/task/087-task-09)

- [087 Task 10 (Open)](/task/087-task-10)

- [087 Task 11 (Open)](/task/087-task-11)

- [087 Task 12 (Open)](/task/087-task-12)

- [087 Task 02 (Open)](/task/087-task-02)

- [087 Task 13 (Open)](/task/087-task-13)

- [087 Task 14 (Open)](/task/087-task-14)

- [087 Task 15 (Open)](/task/087-task-15)'
alpine read /task-collection/roadmap-087 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 087

- [087 Before (Open)](/task/087-before)

- [087 Task 01 (Open)](/task/087-task-01)

- [087 Task 03 (Open)](/task/087-task-03)

- [087 Task 04 (Open)](/task/087-task-04)

- [087 Task 05 (Open)](/task/087-task-05)

- [087 Task 06 (Open)](/task/087-task-06)

- [087 Task 07 (Open)](/task/087-task-07)

- [087 Condition previous 1 (Open)](/task/087-condition-previous-1)

- [087 Task 08 (Open)](/task/087-task-08)

- [087 Task 09 (Open)](/task/087-task-09)

- [087 Task 10 (Open)](/task/087-task-10)

- [087 Task 11 (Open)](/task/087-task-11)

- [087 Task 12 (Open)](/task/087-task-12)

- [087 Task 02 (Open)](/task/087-task-02)

- [087 Task 13 (Open)](/task/087-task-13)

- [087 Task 14 (Open)](/task/087-task-14)

- [087 Task 15 (Open)](/task/087-task-15)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task page subtasks list; two other adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 088

## Subtasks

- 088 Task 01 (Open)
- 088 Task 02 (Open)
- 088 Task 03 (Open)
- 088 Task 04 (Open)
- 088 Task 05 (Open)
- 088 Task 06 (Open)
- 088 Task 07 (Open)
- 088 Task 08 (Open)
- 088 Task 09 (Open)
- 088 Task 10 (Open)
- 088 Task 11 (Open)
- 088 Task 12 (Open)
- 088 Task 13 (Open)
- 088 Task 14 (Open)
- 088 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 088](/task/parent-088).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-088 --limit 100kb >/dev/null
alpine update /task/parent-088 \\
  --old '- [088 Task 01 (Open)](/task/088-task-01)

- [088 Task 02 (Open)](/task/088-task-02)

- [088 Task 03 (Open)](/task/088-task-03)

- [088 Task 04 (Open)](/task/088-task-04)

- [088 Task 05 (Open)](/task/088-task-05)

- [088 Task 06 (Open)](/task/088-task-06)

- [088 Task 07 (Open)](/task/088-task-07)

- [088 Task 08 (Open)](/task/088-task-08)

- [088 Task 09 (Open)](/task/088-task-09)

- [088 Task 10 (Open)](/task/088-task-10)

- [088 Task 11 (Open)](/task/088-task-11)

- [088 Task 12 (Open)](/task/088-task-12)

- [088 Task 13 (Open)](/task/088-task-13)

- [088 Task 14 (Open)](/task/088-task-14)

- [088 Task 15 (Open)](/task/088-task-15)' \\
  --new '- [088 Task 01 (Open)](/task/088-task-01)

- [088 Task 02 (Open)](/task/088-task-02)

- [088 Task 03 (Open)](/task/088-task-03)

- [088 Task 04 (Open)](/task/088-task-04)

- [088 Task 05 (Open)](/task/088-task-05)

- [088 Task 06 (Open)](/task/088-task-06)

- [088 Task 07 (Open)](/task/088-task-07)

- 088 Condition previous 1 (Open)

- 088 Condition previous 2 (Open)

- [088 Task 08 (Open)](/task/088-task-08)

- [088 Task 09 (Open)](/task/088-task-09)

- [088 Task 10 (Open)](/task/088-task-10)

- [088 Task 11 (Open)](/task/088-task-11)

- [088 Task 12 (Open)](/task/088-task-12)

- [088 Task 13 (Open)](/task/088-task-13)

- [088 Task 14 (Open)](/task/088-task-14)

- [088 Task 15 (Open)](/task/088-task-15)'
alpine update /task/parent-088 \\
  --old '- [088 Task 01 (Open)](/task/088-task-01)

- [088 Task 02 (Open)](/task/088-task-02)

- [088 Task 03 (Open)](/task/088-task-03)

- [088 Task 04 (Open)](/task/088-task-04)

- [088 Task 05 (Open)](/task/088-task-05)

- [088 Task 06 (Open)](/task/088-task-06)

- [088 Task 07 (Open)](/task/088-task-07)

- 088 Condition previous 1 (Open)

- 088 Condition previous 2 (Open)

- [088 Task 08 (Open)](/task/088-task-08)

- [088 Task 09 (Open)](/task/088-task-09)

- [088 Task 10 (Open)](/task/088-task-10)

- [088 Task 11 (Open)](/task/088-task-11)

- [088 Task 12 (Open)](/task/088-task-12)

- [088 Task 13 (Open)](/task/088-task-13)

- [088 Task 14 (Open)](/task/088-task-14)

- [088 Task 15 (Open)](/task/088-task-15)' \\
  --new '- [088 Task 01 (Open)](/task/088-task-01)

- [088 Task 03 (Open)](/task/088-task-03)

- [088 Task 04 (Open)](/task/088-task-04)

- [088 Task 05 (Open)](/task/088-task-05)

- [088 Task 06 (Open)](/task/088-task-06)

- [088 Task 07 (Open)](/task/088-task-07)

- 088 Condition previous 1 (Open)

- 088 Condition previous 2 (Open)

- [088 Task 08 (Open)](/task/088-task-08)

- [088 Task 09 (Open)](/task/088-task-09)

- [088 Task 10 (Open)](/task/088-task-10)

- [088 Task 11 (Open)](/task/088-task-11)

- [088 Task 12 (Open)](/task/088-task-12)

- [088 Task 02 (Open)](/task/088-task-02)

- [088 Task 13 (Open)](/task/088-task-13)

- [088 Task 14 (Open)](/task/088-task-14)

- [088 Task 15 (Open)](/task/088-task-15)'
alpine read /task/parent-088 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Parent 088

- Status: Open

## Subtasks

- [088 Task 01 (Open)](/task/088-task-01)

- [088 Task 03 (Open)](/task/088-task-03)

- [088 Task 04 (Open)](/task/088-task-04)

- [088 Task 05 (Open)](/task/088-task-05)

- [088 Task 06 (Open)](/task/088-task-06)

- [088 Task 07 (Open)](/task/088-task-07)

- [088 Condition previous 1 (Open)](/task/088-condition-previous-1)

- [088 Condition previous 2 (Open)](/task/088-condition-previous-2)

- [088 Task 08 (Open)](/task/088-task-08)

- [088 Task 09 (Open)](/task/088-task-09)

- [088 Task 10 (Open)](/task/088-task-10)

- [088 Task 11 (Open)](/task/088-task-11)

- [088 Task 12 (Open)](/task/088-task-12)

- [088 Task 02 (Open)](/task/088-task-02)

- [088 Task 13 (Open)](/task/088-task-13)

- [088 Task 14 (Open)](/task/088-task-14)

- [088 Task 15 (Open)](/task/088-task-15)
`);
});

test("one existing task to the bottom third from the top third; task subtasks page head; two other non-adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 089

## Subtasks

- 089 Task 01 (Open)
- 089 Task 02 (Open)
- 089 Task 03 (Open)
- 089 Task 04 (Open)
- 089 Task 05 (Open)
- 089 Task 06 (Open)
- 089 Task 07 (Open)
- 089 Task 08 (Open)
- 089 Task 09 (Open)
- 089 Task 10 (Open)
- 089 Task 11 (Open)
- 089 Task 12 (Open)
- 089 Task 13 (Open)
- 089 Task 14 (Open)
- 089 Task 15 (Open)
- 089 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 089](/task/parent-089).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-089/subtasks --limit 850b >/dev/null
alpine update /task/parent-089/subtasks \\
  --old '- [089 Task 01 (Open)](/task/089-task-01)

- [089 Task 02 (Open)](/task/089-task-02)

- [089 Task 03 (Open)](/task/089-task-03)

- [089 Task 04 (Open)](/task/089-task-04)

- [089 Task 05 (Open)](/task/089-task-05)

- [089 Task 06 (Open)](/task/089-task-06)

- [089 Task 07 (Open)](/task/089-task-07)

- [089 Task 08 (Open)](/task/089-task-08)

- [089 Task 09 (Open)](/task/089-task-09)

- [089 Task 10 (Open)](/task/089-task-10)

- [089 Task 11 (Open)](/task/089-task-11)

- [089 Task 12 (Open)](/task/089-task-12)

- [089 Task 13 (Open)](/task/089-task-13)

- [089 Task 14 (Open)](/task/089-task-14)

- [089 Task 15 (Open)](/task/089-task-15)' \\
  --new '- [089 Task 01 (Open)](/task/089-task-01)

- [089 Task 02 (Open)](/task/089-task-02)

- [089 Task 03 (Open)](/task/089-task-03)

- [089 Task 04 (Open)](/task/089-task-04)

- [089 Task 05 (Open)](/task/089-task-05)

- [089 Task 06 (Open)](/task/089-task-06)

- 089 Condition previous 1 (Open)

- [089 Task 07 (Open)](/task/089-task-07)

- [089 Task 08 (Open)](/task/089-task-08)

- [089 Task 09 (Open)](/task/089-task-09)

- 089 Condition previous 2 (Open)

- [089 Task 10 (Open)](/task/089-task-10)

- [089 Task 11 (Open)](/task/089-task-11)

- [089 Task 12 (Open)](/task/089-task-12)

- [089 Task 13 (Open)](/task/089-task-13)

- [089 Task 14 (Open)](/task/089-task-14)

- [089 Task 15 (Open)](/task/089-task-15)'
alpine update /task/parent-089/subtasks \\
  --old '- [089 Task 01 (Open)](/task/089-task-01)

- [089 Task 02 (Open)](/task/089-task-02)

- [089 Task 03 (Open)](/task/089-task-03)

- [089 Task 04 (Open)](/task/089-task-04)

- [089 Task 05 (Open)](/task/089-task-05)

- [089 Task 06 (Open)](/task/089-task-06)

- 089 Condition previous 1 (Open)

- [089 Task 07 (Open)](/task/089-task-07)

- [089 Task 08 (Open)](/task/089-task-08)

- [089 Task 09 (Open)](/task/089-task-09)

- 089 Condition previous 2 (Open)

- [089 Task 10 (Open)](/task/089-task-10)

- [089 Task 11 (Open)](/task/089-task-11)

- [089 Task 12 (Open)](/task/089-task-12)

- [089 Task 13 (Open)](/task/089-task-13)

- [089 Task 14 (Open)](/task/089-task-14)

- [089 Task 15 (Open)](/task/089-task-15)' \\
  --new '- [089 Task 01 (Open)](/task/089-task-01)

- [089 Task 03 (Open)](/task/089-task-03)

- [089 Task 04 (Open)](/task/089-task-04)

- [089 Task 05 (Open)](/task/089-task-05)

- [089 Task 06 (Open)](/task/089-task-06)

- 089 Condition previous 1 (Open)

- [089 Task 07 (Open)](/task/089-task-07)

- [089 Task 08 (Open)](/task/089-task-08)

- [089 Task 09 (Open)](/task/089-task-09)

- 089 Condition previous 2 (Open)

- [089 Task 10 (Open)](/task/089-task-10)

- [089 Task 11 (Open)](/task/089-task-11)

- [089 Task 12 (Open)](/task/089-task-12)

- [089 Task 02 (Open)](/task/089-task-02)

- [089 Task 13 (Open)](/task/089-task-13)

- [089 Task 14 (Open)](/task/089-task-14)

- [089 Task 15 (Open)](/task/089-task-15)'
alpine read /task/parent-089/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 089 (Open)](/task/parent-089).

- [089 Task 01 (Open)](/task/089-task-01)

- [089 Task 03 (Open)](/task/089-task-03)

- [089 Task 04 (Open)](/task/089-task-04)

- [089 Task 05 (Open)](/task/089-task-05)

- [089 Task 06 (Open)](/task/089-task-06)

- [089 Condition previous 1 (Open)](/task/089-condition-previous-1)

- [089 Task 07 (Open)](/task/089-task-07)

- [089 Task 08 (Open)](/task/089-task-08)

- [089 Task 09 (Open)](/task/089-task-09)

- [089 Condition previous 2 (Open)](/task/089-condition-previous-2)

- [089 Task 10 (Open)](/task/089-task-10)

- [089 Task 11 (Open)](/task/089-task-11)

- [089 Task 12 (Open)](/task/089-task-12)

- [089 Task 02 (Open)](/task/089-task-02)

- [089 Task 13 (Open)](/task/089-task-13)

- [089 Task 14 (Open)](/task/089-task-14)

- [089 Task 15 (Open)](/task/089-task-15)

- [089 After pagination guard with a deliberately long title (Open)](/task/089-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task subtasks page tail that is not the end; one other existing task moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 090

## Subtasks

- 090 Before (Open)
- 090 Task 01 (Open)
- 090 Task 02 (Open)
- 090 Task 03 (Open)
- 090 Task 04 (Open)
- 090 Task 05 (Open)
- 090 Task 06 (Open)
- 090 Task 07 (Open)
- 090 Task 08 (Open)
- 090 Task 09 (Open)
- 090 Task 10 (Open)
- 090 Task 11 (Open)
- 090 Task 12 (Open)
- 090 Task 13 (Open)
- 090 Task 14 (Open)
- 090 Task 15 (Open)
- 090 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 090](/task/parent-090).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-090/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [090 Task 01 (Open)](/task/090-task-01)

- [090 Task 02 (Open)](/task/090-task-02)

- [090 Task 03 (Open)](/task/090-task-03)

- [090 Task 04 (Open)](/task/090-task-04)

- [090 Task 05 (Open)](/task/090-task-05)

- [090 Task 06 (Open)](/task/090-task-06)

- [090 Task 07 (Open)](/task/090-task-07)

- [090 Task 08 (Open)](/task/090-task-08)

- [090 Task 09 (Open)](/task/090-task-09)

- [090 Task 10 (Open)](/task/090-task-10)

- [090 Task 11 (Open)](/task/090-task-11)

- [090 Task 12 (Open)](/task/090-task-12)

- [090 Task 13 (Open)](/task/090-task-13)

- [090 Task 14 (Open)](/task/090-task-14)

- [090 Task 15 (Open)](/task/090-task-15)' \\
  --new '- [090 Task 01 (Open)](/task/090-task-01)

- [090 Task 03 (Open)](/task/090-task-03)

- [090 Task 04 (Open)](/task/090-task-04)

- [090 Task 05 (Open)](/task/090-task-05)

- [090 Task 06 (Open)](/task/090-task-06)

- [090 Task 07 (Open)](/task/090-task-07)

- [090 Task 09 (Open)](/task/090-task-09)

- [090 Task 10 (Open)](/task/090-task-10)

- [090 Task 08 (Open)](/task/090-task-08)

- [090 Task 11 (Open)](/task/090-task-11)

- [090 Task 12 (Open)](/task/090-task-12)

- [090 Task 02 (Open)](/task/090-task-02)

- [090 Task 13 (Open)](/task/090-task-13)

- [090 Task 14 (Open)](/task/090-task-14)

- [090 Task 15 (Open)](/task/090-task-15)'
alpine read /task/parent-090/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 090 (Open)](/task/parent-090).

- [090 Before (Open)](/task/090-before)

- [090 Task 01 (Open)](/task/090-task-01)

- [090 Task 03 (Open)](/task/090-task-03)

- [090 Task 04 (Open)](/task/090-task-04)

- [090 Task 05 (Open)](/task/090-task-05)

- [090 Task 06 (Open)](/task/090-task-06)

- [090 Task 07 (Open)](/task/090-task-07)

- [090 Task 09 (Open)](/task/090-task-09)

- [090 Task 10 (Open)](/task/090-task-10)

- [090 Task 08 (Open)](/task/090-task-08)

- [090 Task 11 (Open)](/task/090-task-11)

- [090 Task 12 (Open)](/task/090-task-12)

- [090 Task 02 (Open)](/task/090-task-02)

- [090 Task 13 (Open)](/task/090-task-13)

- [090 Task 14 (Open)](/task/090-task-14)

- [090 Task 15 (Open)](/task/090-task-15)

- [090 After pagination guard with a deliberately long title (Open)](/task/090-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task subtasks page tail at the end; two other existing tasks swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 091

## Subtasks

- 091 Before (Open)
- 091 Task 01 (Open)
- 091 Task 02 (Open)
- 091 Task 03 (Open)
- 091 Task 04 (Open)
- 091 Task 05 (Open)
- 091 Task 06 (Open)
- 091 Task 07 (Open)
- 091 Task 08 (Open)
- 091 Task 09 (Open)
- 091 Task 10 (Open)
- 091 Task 11 (Open)
- 091 Task 12 (Open)
- 091 Task 13 (Open)
- 091 Task 14 (Open)
- 091 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 091](/task/parent-091).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-091/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [091 Task 01 (Open)](/task/091-task-01)

- [091 Task 02 (Open)](/task/091-task-02)

- [091 Task 03 (Open)](/task/091-task-03)

- [091 Task 04 (Open)](/task/091-task-04)

- [091 Task 05 (Open)](/task/091-task-05)

- [091 Task 06 (Open)](/task/091-task-06)

- [091 Task 07 (Open)](/task/091-task-07)

- [091 Task 08 (Open)](/task/091-task-08)

- [091 Task 09 (Open)](/task/091-task-09)

- [091 Task 10 (Open)](/task/091-task-10)

- [091 Task 11 (Open)](/task/091-task-11)

- [091 Task 12 (Open)](/task/091-task-12)

- [091 Task 13 (Open)](/task/091-task-13)

- [091 Task 14 (Open)](/task/091-task-14)

- [091 Task 15 (Open)](/task/091-task-15)' \\
  --new '- [091 Task 01 (Open)](/task/091-task-01)

- [091 Task 03 (Open)](/task/091-task-03)

- [091 Task 04 (Open)](/task/091-task-04)

- [091 Task 05 (Open)](/task/091-task-05)

- [091 Task 06 (Open)](/task/091-task-06)

- [091 Task 09 (Open)](/task/091-task-09)

- [091 Task 08 (Open)](/task/091-task-08)

- [091 Task 07 (Open)](/task/091-task-07)

- [091 Task 10 (Open)](/task/091-task-10)

- [091 Task 11 (Open)](/task/091-task-11)

- [091 Task 12 (Open)](/task/091-task-12)

- [091 Task 02 (Open)](/task/091-task-02)

- [091 Task 13 (Open)](/task/091-task-13)

- [091 Task 14 (Open)](/task/091-task-14)

- [091 Task 15 (Open)](/task/091-task-15)'
alpine read /task/parent-091/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 091 (Open)](/task/parent-091).

- [091 Before (Open)](/task/091-before)

- [091 Task 01 (Open)](/task/091-task-01)

- [091 Task 03 (Open)](/task/091-task-03)

- [091 Task 04 (Open)](/task/091-task-04)

- [091 Task 05 (Open)](/task/091-task-05)

- [091 Task 06 (Open)](/task/091-task-06)

- [091 Task 09 (Open)](/task/091-task-09)

- [091 Task 08 (Open)](/task/091-task-08)

- [091 Task 07 (Open)](/task/091-task-07)

- [091 Task 10 (Open)](/task/091-task-10)

- [091 Task 11 (Open)](/task/091-task-11)

- [091 Task 12 (Open)](/task/091-task-12)

- [091 Task 02 (Open)](/task/091-task-02)

- [091 Task 13 (Open)](/task/091-task-13)

- [091 Task 14 (Open)](/task/091-task-14)

- [091 Task 15 (Open)](/task/091-task-15)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page head; one other link-less task from the previous update moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 092

- 092 Task 01 (Open)
- 092 Task 02 (Open)
- 092 Task 03 (Open)
- 092 Task 04 (Open)
- 092 Task 05 (Open)
- 092 Task 06 (Open)
- 092 Task 07 (Open)
- 092 Task 08 (Open)
- 092 Task 09 (Open)
- 092 Task 10 (Open)
- 092 Task 11 (Open)
- 092 Task 12 (Open)
- 092 Task 13 (Open)
- 092 Task 14 (Open)
- 092 Task 15 (Open)
- 092 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 092](/task-collection/roadmap-092).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-092 --limit 850b >/dev/null
alpine update /task-collection/roadmap-092 \\
  --old '- [092 Task 01 (Open)](/task/092-task-01)

- [092 Task 02 (Open)](/task/092-task-02)

- [092 Task 03 (Open)](/task/092-task-03)

- [092 Task 04 (Open)](/task/092-task-04)

- [092 Task 05 (Open)](/task/092-task-05)

- [092 Task 06 (Open)](/task/092-task-06)

- [092 Task 07 (Open)](/task/092-task-07)

- [092 Task 08 (Open)](/task/092-task-08)

- [092 Task 09 (Open)](/task/092-task-09)

- [092 Task 10 (Open)](/task/092-task-10)

- [092 Task 11 (Open)](/task/092-task-11)

- [092 Task 12 (Open)](/task/092-task-12)

- [092 Task 13 (Open)](/task/092-task-13)

- [092 Task 14 (Open)](/task/092-task-14)

- [092 Task 15 (Open)](/task/092-task-15)' \\
  --new '- [092 Task 01 (Open)](/task/092-task-01)

- [092 Task 02 (Open)](/task/092-task-02)

- [092 Task 03 (Open)](/task/092-task-03)

- [092 Task 04 (Open)](/task/092-task-04)

- [092 Task 05 (Open)](/task/092-task-05)

- [092 Task 06 (Open)](/task/092-task-06)

- [092 Task 07 (Open)](/task/092-task-07)

- 092 Condition previous 1 (Open)

- [092 Task 08 (Open)](/task/092-task-08)

- [092 Task 09 (Open)](/task/092-task-09)

- [092 Task 10 (Open)](/task/092-task-10)

- [092 Task 11 (Open)](/task/092-task-11)

- [092 Task 12 (Open)](/task/092-task-12)

- [092 Task 13 (Open)](/task/092-task-13)

- [092 Task 14 (Open)](/task/092-task-14)

- [092 Task 15 (Open)](/task/092-task-15)'
alpine update /task-collection/roadmap-092 \\
  --old '- [092 Task 01 (Open)](/task/092-task-01)

- [092 Task 02 (Open)](/task/092-task-02)

- [092 Task 03 (Open)](/task/092-task-03)

- [092 Task 04 (Open)](/task/092-task-04)

- [092 Task 05 (Open)](/task/092-task-05)

- [092 Task 06 (Open)](/task/092-task-06)

- [092 Task 07 (Open)](/task/092-task-07)

- 092 Condition previous 1 (Open)

- [092 Task 08 (Open)](/task/092-task-08)

- [092 Task 09 (Open)](/task/092-task-09)

- [092 Task 10 (Open)](/task/092-task-10)

- [092 Task 11 (Open)](/task/092-task-11)

- [092 Task 12 (Open)](/task/092-task-12)

- [092 Task 13 (Open)](/task/092-task-13)

- [092 Task 14 (Open)](/task/092-task-14)

- [092 Task 15 (Open)](/task/092-task-15)' \\
  --new '- [092 Task 01 (Open)](/task/092-task-01)

- [092 Task 03 (Open)](/task/092-task-03)

- [092 Task 04 (Open)](/task/092-task-04)

- [092 Task 05 (Open)](/task/092-task-05)

- [092 Task 06 (Open)](/task/092-task-06)

- [092 Task 07 (Open)](/task/092-task-07)

- [092 Task 08 (Open)](/task/092-task-08)

- [092 Task 09 (Open)](/task/092-task-09)

- [092 Task 10 (Open)](/task/092-task-10)

- 092 Condition previous 1 (Open)

- [092 Task 11 (Open)](/task/092-task-11)

- [092 Task 12 (Open)](/task/092-task-12)

- [092 Task 02 (Open)](/task/092-task-02)

- [092 Task 13 (Open)](/task/092-task-13)

- [092 Task 14 (Open)](/task/092-task-14)

- [092 Task 15 (Open)](/task/092-task-15)'
alpine read /task-collection/roadmap-092 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 092

- [092 Task 01 (Open)](/task/092-task-01)

- [092 Task 03 (Open)](/task/092-task-03)

- [092 Task 04 (Open)](/task/092-task-04)

- [092 Task 05 (Open)](/task/092-task-05)

- [092 Task 06 (Open)](/task/092-task-06)

- [092 Task 07 (Open)](/task/092-task-07)

- [092 Task 08 (Open)](/task/092-task-08)

- [092 Task 09 (Open)](/task/092-task-09)

- [092 Task 10 (Open)](/task/092-task-10)

- [092 Condition previous 1 (Open)](/task/092-condition-previous-1)

- [092 Task 11 (Open)](/task/092-task-11)

- [092 Task 12 (Open)](/task/092-task-12)

- [092 Task 02 (Open)](/task/092-task-02)

- [092 Task 13 (Open)](/task/092-task-13)

- [092 Task 14 (Open)](/task/092-task-14)

- [092 Task 15 (Open)](/task/092-task-15)

- [092 After pagination guard with a deliberately long title (Open)](/task/092-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the bottom third from the top third; task collection page tail that is not the end; two other link-less tasks from the previous update swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 093

- 093 Before (Open)
- 093 Task 01 (Open)
- 093 Task 02 (Open)
- 093 Task 03 (Open)
- 093 Task 04 (Open)
- 093 Task 05 (Open)
- 093 Task 06 (Open)
- 093 Task 07 (Open)
- 093 Task 08 (Open)
- 093 Task 09 (Open)
- 093 Task 10 (Open)
- 093 Task 11 (Open)
- 093 Task 12 (Open)
- 093 Task 13 (Open)
- 093 Task 14 (Open)
- 093 Task 15 (Open)
- 093 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 093](/task-collection/roadmap-093).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-093 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [093 Task 01 (Open)](/task/093-task-01)

- [093 Task 02 (Open)](/task/093-task-02)

- [093 Task 03 (Open)](/task/093-task-03)

- [093 Task 04 (Open)](/task/093-task-04)

- [093 Task 05 (Open)](/task/093-task-05)

- [093 Task 06 (Open)](/task/093-task-06)

- [093 Task 07 (Open)](/task/093-task-07)

- [093 Task 08 (Open)](/task/093-task-08)

- [093 Task 09 (Open)](/task/093-task-09)

- [093 Task 10 (Open)](/task/093-task-10)

- [093 Task 11 (Open)](/task/093-task-11)

- [093 Task 12 (Open)](/task/093-task-12)

- [093 Task 13 (Open)](/task/093-task-13)

- [093 Task 14 (Open)](/task/093-task-14)

- [093 Task 15 (Open)](/task/093-task-15)' \\
  --new '- [093 Task 01 (Open)](/task/093-task-01)

- [093 Task 02 (Open)](/task/093-task-02)

- [093 Task 03 (Open)](/task/093-task-03)

- [093 Task 04 (Open)](/task/093-task-04)

- [093 Task 05 (Open)](/task/093-task-05)

- [093 Task 06 (Open)](/task/093-task-06)

- 093 Condition previous 1 (Open)

- [093 Task 07 (Open)](/task/093-task-07)

- [093 Task 08 (Open)](/task/093-task-08)

- [093 Task 09 (Open)](/task/093-task-09)

- 093 Condition previous 2 (Open)

- [093 Task 10 (Open)](/task/093-task-10)

- [093 Task 11 (Open)](/task/093-task-11)

- [093 Task 12 (Open)](/task/093-task-12)

- [093 Task 13 (Open)](/task/093-task-13)

- [093 Task 14 (Open)](/task/093-task-14)

- [093 Task 15 (Open)](/task/093-task-15)'
alpine update $path \\
  --old '- [093 Task 01 (Open)](/task/093-task-01)

- [093 Task 02 (Open)](/task/093-task-02)

- [093 Task 03 (Open)](/task/093-task-03)

- [093 Task 04 (Open)](/task/093-task-04)

- [093 Task 05 (Open)](/task/093-task-05)

- [093 Task 06 (Open)](/task/093-task-06)

- 093 Condition previous 1 (Open)

- [093 Task 07 (Open)](/task/093-task-07)

- [093 Task 08 (Open)](/task/093-task-08)

- [093 Task 09 (Open)](/task/093-task-09)

- 093 Condition previous 2 (Open)

- [093 Task 10 (Open)](/task/093-task-10)

- [093 Task 11 (Open)](/task/093-task-11)

- [093 Task 12 (Open)](/task/093-task-12)

- [093 Task 13 (Open)](/task/093-task-13)

- [093 Task 14 (Open)](/task/093-task-14)

- [093 Task 15 (Open)](/task/093-task-15)' \\
  --new '- [093 Task 01 (Open)](/task/093-task-01)

- [093 Task 03 (Open)](/task/093-task-03)

- [093 Task 04 (Open)](/task/093-task-04)

- [093 Task 05 (Open)](/task/093-task-05)

- [093 Task 06 (Open)](/task/093-task-06)

- 093 Condition previous 2 (Open)

- [093 Task 07 (Open)](/task/093-task-07)

- [093 Task 08 (Open)](/task/093-task-08)

- [093 Task 09 (Open)](/task/093-task-09)

- 093 Condition previous 1 (Open)

- [093 Task 10 (Open)](/task/093-task-10)

- [093 Task 11 (Open)](/task/093-task-11)

- [093 Task 12 (Open)](/task/093-task-12)

- [093 Task 02 (Open)](/task/093-task-02)

- [093 Task 13 (Open)](/task/093-task-13)

- [093 Task 14 (Open)](/task/093-task-14)

- [093 Task 15 (Open)](/task/093-task-15)'
alpine read /task-collection/roadmap-093 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 093

- [093 Before (Open)](/task/093-before)

- [093 Task 01 (Open)](/task/093-task-01)

- [093 Task 03 (Open)](/task/093-task-03)

- [093 Task 04 (Open)](/task/093-task-04)

- [093 Task 05 (Open)](/task/093-task-05)

- [093 Task 06 (Open)](/task/093-task-06)

- [093 Condition previous 2 (Open)](/task/093-condition-previous-2)

- [093 Task 07 (Open)](/task/093-task-07)

- [093 Task 08 (Open)](/task/093-task-08)

- [093 Task 09 (Open)](/task/093-task-09)

- [093 Condition previous 1 (Open)](/task/093-condition-previous-1)

- [093 Task 10 (Open)](/task/093-task-10)

- [093 Task 11 (Open)](/task/093-task-11)

- [093 Task 12 (Open)](/task/093-task-12)

- [093 Task 02 (Open)](/task/093-task-02)

- [093 Task 13 (Open)](/task/093-task-13)

- [093 Task 14 (Open)](/task/093-task-14)

- [093 Task 15 (Open)](/task/093-task-15)

- [093 After pagination guard with a deliberately long title (Open)](/task/093-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task collection page tail at the end; 15 tasks", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 094

- 094 Before (Open)
- 094 Task 01 (Open)
- 094 Task 02 (Open)
- 094 Task 03 (Open)
- 094 Task 04 (Open)
- 094 Task 05 (Open)
- 094 Task 06 (Open)
- 094 Task 07 (Open)
- 094 Task 08 (Open)
- 094 Task 09 (Open)
- 094 Task 10 (Open)
- 094 Task 11 (Open)
- 094 Task 12 (Open)
- 094 Task 13 (Open)
- 094 Task 14 (Open)
- 094 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 094](/task-collection/roadmap-094).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-094 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [094 Task 01 (Open)](/task/094-task-01)

- [094 Task 02 (Open)](/task/094-task-02)

- [094 Task 03 (Open)](/task/094-task-03)

- [094 Task 04 (Open)](/task/094-task-04)

- [094 Task 05 (Open)](/task/094-task-05)

- [094 Task 06 (Open)](/task/094-task-06)

- [094 Task 07 (Open)](/task/094-task-07)

- [094 Task 08 (Open)](/task/094-task-08)

- [094 Task 09 (Open)](/task/094-task-09)

- [094 Task 10 (Open)](/task/094-task-10)

- [094 Task 11 (Open)](/task/094-task-11)

- [094 Task 12 (Open)](/task/094-task-12)

- [094 Task 13 (Open)](/task/094-task-13)

- [094 Task 14 (Open)](/task/094-task-14)

- [094 Task 15 (Open)](/task/094-task-15)' \\
  --new '- [094 Task 01 (Open)](/task/094-task-01)

- [094 Task 02 (Open)](/task/094-task-02)

- [094 Task 03 (Open)](/task/094-task-03)

- [094 Task 10 (Open)](/task/094-task-10)

- [094 Task 04 (Open)](/task/094-task-04)

- [094 Task 05 (Open)](/task/094-task-05)

- [094 Task 06 (Open)](/task/094-task-06)

- [094 Task 07 (Open)](/task/094-task-07)

- [094 Task 08 (Open)](/task/094-task-08)

- [094 Task 09 (Open)](/task/094-task-09)

- [094 Task 11 (Open)](/task/094-task-11)

- [094 Task 12 (Open)](/task/094-task-12)

- [094 Task 13 (Open)](/task/094-task-13)

- [094 Task 14 (Open)](/task/094-task-14)

- [094 Task 15 (Open)](/task/094-task-15)'
alpine read /task-collection/roadmap-094 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 094

- [094 Before (Open)](/task/094-before)

- [094 Task 01 (Open)](/task/094-task-01)

- [094 Task 02 (Open)](/task/094-task-02)

- [094 Task 03 (Open)](/task/094-task-03)

- [094 Task 10 (Open)](/task/094-task-10)

- [094 Task 04 (Open)](/task/094-task-04)

- [094 Task 05 (Open)](/task/094-task-05)

- [094 Task 06 (Open)](/task/094-task-06)

- [094 Task 07 (Open)](/task/094-task-07)

- [094 Task 08 (Open)](/task/094-task-08)

- [094 Task 09 (Open)](/task/094-task-09)

- [094 Task 11 (Open)](/task/094-task-11)

- [094 Task 12 (Open)](/task/094-task-12)

- [094 Task 13 (Open)](/task/094-task-13)

- [094 Task 14 (Open)](/task/094-task-14)

- [094 Task 15 (Open)](/task/094-task-15)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task page subtasks list; one other task created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 095

## Subtasks

- 095 Task 01 (Open)
- 095 Task 02 (Open)
- 095 Task 03 (Open)
- 095 Task 04 (Open)
- 095 Task 05 (Open)
- 095 Task 06 (Open)
- 095 Task 07 (Open)
- 095 Task 08 (Open)
- 095 Task 09 (Open)
- 095 Task 10 (Open)
- 095 Task 11 (Open)
- 095 Task 12 (Open)
- 095 Task 13 (Open)
- 095 Task 14 (Open)
- 095 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 095](/task/parent-095).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-095 --limit 100kb >/dev/null
alpine update /task/parent-095 \\
  --old '- [095 Task 01 (Open)](/task/095-task-01)

- [095 Task 02 (Open)](/task/095-task-02)

- [095 Task 03 (Open)](/task/095-task-03)

- [095 Task 04 (Open)](/task/095-task-04)

- [095 Task 05 (Open)](/task/095-task-05)

- [095 Task 06 (Open)](/task/095-task-06)

- [095 Task 07 (Open)](/task/095-task-07)

- [095 Task 08 (Open)](/task/095-task-08)

- [095 Task 09 (Open)](/task/095-task-09)

- [095 Task 10 (Open)](/task/095-task-10)

- [095 Task 11 (Open)](/task/095-task-11)

- [095 Task 12 (Open)](/task/095-task-12)

- [095 Task 13 (Open)](/task/095-task-13)

- [095 Task 14 (Open)](/task/095-task-14)

- [095 Task 15 (Open)](/task/095-task-15)' \\
  --new '- [095 Task 01 (Open)](/task/095-task-01)

- [095 Task 02 (Open)](/task/095-task-02)

- [095 Task 03 (Open)](/task/095-task-03)

- [095 Task 10 (Open)](/task/095-task-10)

- [095 Task 04 (Open)](/task/095-task-04)

- [095 Task 05 (Open)](/task/095-task-05)

- [095 Task 06 (Open)](/task/095-task-06)

- [095 Task 07 (Open)](/task/095-task-07)

- 095 Condition new 1 (Open)

- [095 Task 08 (Open)](/task/095-task-08)

- [095 Task 09 (Open)](/task/095-task-09)

- [095 Task 11 (Open)](/task/095-task-11)

- [095 Task 12 (Open)](/task/095-task-12)

- [095 Task 13 (Open)](/task/095-task-13)

- [095 Task 14 (Open)](/task/095-task-14)

- [095 Task 15 (Open)](/task/095-task-15)'
alpine read /task/parent-095 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 095

- Status: Open

## Subtasks

- [095 Task 01 (Open)](/task/095-task-01)

- [095 Task 02 (Open)](/task/095-task-02)

- [095 Task 03 (Open)](/task/095-task-03)

- [095 Task 10 (Open)](/task/095-task-10)

- [095 Task 04 (Open)](/task/095-task-04)

- [095 Task 05 (Open)](/task/095-task-05)

- [095 Task 06 (Open)](/task/095-task-06)

- [095 Task 07 (Open)](/task/095-task-07)

- [095 Condition new 1 (Open)](/task/095-condition-new-1)

- [095 Task 08 (Open)](/task/095-task-08)

- [095 Task 09 (Open)](/task/095-task-09)

- [095 Task 11 (Open)](/task/095-task-11)

- [095 Task 12 (Open)](/task/095-task-12)

- [095 Task 13 (Open)](/task/095-task-13)

- [095 Task 14 (Open)](/task/095-task-14)

- [095 Task 15 (Open)](/task/095-task-15)
`);
});

test("one existing task to the top third from the bottom third; task subtasks page head; two other adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 096

## Subtasks

- 096 Task 01 (Open)
- 096 Task 02 (Open)
- 096 Task 03 (Open)
- 096 Task 04 (Open)
- 096 Task 05 (Open)
- 096 Task 06 (Open)
- 096 Task 07 (Open)
- 096 Task 08 (Open)
- 096 Task 09 (Open)
- 096 Task 10 (Open)
- 096 Task 11 (Open)
- 096 Task 12 (Open)
- 096 Task 13 (Open)
- 096 Task 14 (Open)
- 096 Task 15 (Open)
- 096 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 096](/task/parent-096).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-096/subtasks --limit 850b >/dev/null
alpine update /task/parent-096/subtasks \\
  --old '- [096 Task 01 (Open)](/task/096-task-01)

- [096 Task 02 (Open)](/task/096-task-02)

- [096 Task 03 (Open)](/task/096-task-03)

- [096 Task 04 (Open)](/task/096-task-04)

- [096 Task 05 (Open)](/task/096-task-05)

- [096 Task 06 (Open)](/task/096-task-06)

- [096 Task 07 (Open)](/task/096-task-07)

- [096 Task 08 (Open)](/task/096-task-08)

- [096 Task 09 (Open)](/task/096-task-09)

- [096 Task 10 (Open)](/task/096-task-10)

- [096 Task 11 (Open)](/task/096-task-11)

- [096 Task 12 (Open)](/task/096-task-12)

- [096 Task 13 (Open)](/task/096-task-13)

- [096 Task 14 (Open)](/task/096-task-14)

- [096 Task 15 (Open)](/task/096-task-15)' \\
  --new '- [096 Task 01 (Open)](/task/096-task-01)

- [096 Task 02 (Open)](/task/096-task-02)

- [096 Task 03 (Open)](/task/096-task-03)

- [096 Task 10 (Open)](/task/096-task-10)

- [096 Task 04 (Open)](/task/096-task-04)

- [096 Task 05 (Open)](/task/096-task-05)

- [096 Task 06 (Open)](/task/096-task-06)

- [096 Task 07 (Open)](/task/096-task-07)

- 096 Condition new 1 (Open)

- 096 Condition new 2 (Open)

- [096 Task 08 (Open)](/task/096-task-08)

- [096 Task 09 (Open)](/task/096-task-09)

- [096 Task 11 (Open)](/task/096-task-11)

- [096 Task 12 (Open)](/task/096-task-12)

- [096 Task 13 (Open)](/task/096-task-13)

- [096 Task 14 (Open)](/task/096-task-14)

- [096 Task 15 (Open)](/task/096-task-15)'
alpine read /task/parent-096/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 096 (Open)](/task/parent-096).

- [096 Task 01 (Open)](/task/096-task-01)

- [096 Task 02 (Open)](/task/096-task-02)

- [096 Task 03 (Open)](/task/096-task-03)

- [096 Task 10 (Open)](/task/096-task-10)

- [096 Task 04 (Open)](/task/096-task-04)

- [096 Task 05 (Open)](/task/096-task-05)

- [096 Task 06 (Open)](/task/096-task-06)

- [096 Task 07 (Open)](/task/096-task-07)

- [096 Condition new 1 (Open)](/task/096-condition-new-1)

- [096 Condition new 2 (Open)](/task/096-condition-new-2)

- [096 Task 08 (Open)](/task/096-task-08)

- [096 Task 09 (Open)](/task/096-task-09)

- [096 Task 11 (Open)](/task/096-task-11)

- [096 Task 12 (Open)](/task/096-task-12)

- [096 Task 13 (Open)](/task/096-task-13)

- [096 Task 14 (Open)](/task/096-task-14)

- [096 Task 15 (Open)](/task/096-task-15)

- [096 After pagination guard with a deliberately long title (Open)](/task/096-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task subtasks page tail that is not the end; two other non-adjacent tasks created in the middle in the same update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 097

## Subtasks

- 097 Before (Open)
- 097 Task 01 (Open)
- 097 Task 02 (Open)
- 097 Task 03 (Open)
- 097 Task 04 (Open)
- 097 Task 05 (Open)
- 097 Task 06 (Open)
- 097 Task 07 (Open)
- 097 Task 08 (Open)
- 097 Task 09 (Open)
- 097 Task 10 (Open)
- 097 Task 11 (Open)
- 097 Task 12 (Open)
- 097 Task 13 (Open)
- 097 Task 14 (Open)
- 097 Task 15 (Open)
- 097 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 097](/task/parent-097).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-097/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [097 Task 01 (Open)](/task/097-task-01)

- [097 Task 02 (Open)](/task/097-task-02)

- [097 Task 03 (Open)](/task/097-task-03)

- [097 Task 04 (Open)](/task/097-task-04)

- [097 Task 05 (Open)](/task/097-task-05)

- [097 Task 06 (Open)](/task/097-task-06)

- [097 Task 07 (Open)](/task/097-task-07)

- [097 Task 08 (Open)](/task/097-task-08)

- [097 Task 09 (Open)](/task/097-task-09)

- [097 Task 10 (Open)](/task/097-task-10)

- [097 Task 11 (Open)](/task/097-task-11)

- [097 Task 12 (Open)](/task/097-task-12)

- [097 Task 13 (Open)](/task/097-task-13)

- [097 Task 14 (Open)](/task/097-task-14)

- [097 Task 15 (Open)](/task/097-task-15)' \\
  --new '- [097 Task 01 (Open)](/task/097-task-01)

- [097 Task 02 (Open)](/task/097-task-02)

- [097 Task 03 (Open)](/task/097-task-03)

- 097 Condition new 2 (Open)

- [097 Task 10 (Open)](/task/097-task-10)

- [097 Task 04 (Open)](/task/097-task-04)

- [097 Task 05 (Open)](/task/097-task-05)

- [097 Task 06 (Open)](/task/097-task-06)

- 097 Condition new 1 (Open)

- [097 Task 07 (Open)](/task/097-task-07)

- [097 Task 08 (Open)](/task/097-task-08)

- [097 Task 09 (Open)](/task/097-task-09)

- [097 Task 11 (Open)](/task/097-task-11)

- [097 Task 12 (Open)](/task/097-task-12)

- [097 Task 13 (Open)](/task/097-task-13)

- [097 Task 14 (Open)](/task/097-task-14)

- [097 Task 15 (Open)](/task/097-task-15)'
alpine read /task/parent-097/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Subtasks for [Parent 097 (Open)](/task/parent-097).

- [097 Before (Open)](/task/097-before)

- [097 Task 01 (Open)](/task/097-task-01)

- [097 Task 02 (Open)](/task/097-task-02)

- [097 Task 03 (Open)](/task/097-task-03)

- [097 Condition new 2 (Open)](/task/097-condition-new-2)

- [097 Task 10 (Open)](/task/097-task-10)

- [097 Task 04 (Open)](/task/097-task-04)

- [097 Task 05 (Open)](/task/097-task-05)

- [097 Task 06 (Open)](/task/097-task-06)

- [097 Condition new 1 (Open)](/task/097-condition-new-1)

- [097 Task 07 (Open)](/task/097-task-07)

- [097 Task 08 (Open)](/task/097-task-08)

- [097 Task 09 (Open)](/task/097-task-09)

- [097 Task 11 (Open)](/task/097-task-11)

- [097 Task 12 (Open)](/task/097-task-12)

- [097 Task 13 (Open)](/task/097-task-13)

- [097 Task 14 (Open)](/task/097-task-14)

- [097 Task 15 (Open)](/task/097-task-15)

- [097 After pagination guard with a deliberately long title (Open)](/task/097-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task subtasks page tail at the end; one other task created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 098

## Subtasks

- 098 Before (Open)
- 098 Task 01 (Open)
- 098 Task 02 (Open)
- 098 Task 03 (Open)
- 098 Task 04 (Open)
- 098 Task 05 (Open)
- 098 Task 06 (Open)
- 098 Task 07 (Open)
- 098 Task 08 (Open)
- 098 Task 09 (Open)
- 098 Task 10 (Open)
- 098 Task 11 (Open)
- 098 Task 12 (Open)
- 098 Task 13 (Open)
- 098 Task 14 (Open)
- 098 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 098](/task/parent-098).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-098/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [098 Task 01 (Open)](/task/098-task-01)

- [098 Task 02 (Open)](/task/098-task-02)

- [098 Task 03 (Open)](/task/098-task-03)

- [098 Task 04 (Open)](/task/098-task-04)

- [098 Task 05 (Open)](/task/098-task-05)

- [098 Task 06 (Open)](/task/098-task-06)

- [098 Task 07 (Open)](/task/098-task-07)

- [098 Task 08 (Open)](/task/098-task-08)

- [098 Task 09 (Open)](/task/098-task-09)

- [098 Task 10 (Open)](/task/098-task-10)

- [098 Task 11 (Open)](/task/098-task-11)

- [098 Task 12 (Open)](/task/098-task-12)

- [098 Task 13 (Open)](/task/098-task-13)

- [098 Task 14 (Open)](/task/098-task-14)

- [098 Task 15 (Open)](/task/098-task-15)' \\
  --new '- [098 Task 01 (Open)](/task/098-task-01)

- [098 Task 02 (Open)](/task/098-task-02)

- [098 Task 03 (Open)](/task/098-task-03)

- [098 Task 04 (Open)](/task/098-task-04)

- [098 Task 05 (Open)](/task/098-task-05)

- [098 Task 06 (Open)](/task/098-task-06)

- [098 Task 07 (Open)](/task/098-task-07)

- 098 Condition previous 1 (Open)

- [098 Task 08 (Open)](/task/098-task-08)

- [098 Task 09 (Open)](/task/098-task-09)

- [098 Task 10 (Open)](/task/098-task-10)

- [098 Task 11 (Open)](/task/098-task-11)

- [098 Task 12 (Open)](/task/098-task-12)

- [098 Task 13 (Open)](/task/098-task-13)

- [098 Task 14 (Open)](/task/098-task-14)

- [098 Task 15 (Open)](/task/098-task-15)'
alpine update $path \\
  --old '- [098 Task 01 (Open)](/task/098-task-01)

- [098 Task 02 (Open)](/task/098-task-02)

- [098 Task 03 (Open)](/task/098-task-03)

- [098 Task 04 (Open)](/task/098-task-04)

- [098 Task 05 (Open)](/task/098-task-05)

- [098 Task 06 (Open)](/task/098-task-06)

- [098 Task 07 (Open)](/task/098-task-07)

- 098 Condition previous 1 (Open)

- [098 Task 08 (Open)](/task/098-task-08)

- [098 Task 09 (Open)](/task/098-task-09)

- [098 Task 10 (Open)](/task/098-task-10)

- [098 Task 11 (Open)](/task/098-task-11)

- [098 Task 12 (Open)](/task/098-task-12)

- [098 Task 13 (Open)](/task/098-task-13)

- [098 Task 14 (Open)](/task/098-task-14)

- [098 Task 15 (Open)](/task/098-task-15)' \\
  --new '- [098 Task 01 (Open)](/task/098-task-01)

- [098 Task 02 (Open)](/task/098-task-02)

- [098 Task 03 (Open)](/task/098-task-03)

- [098 Task 10 (Open)](/task/098-task-10)

- [098 Task 04 (Open)](/task/098-task-04)

- [098 Task 05 (Open)](/task/098-task-05)

- [098 Task 06 (Open)](/task/098-task-06)

- [098 Task 07 (Open)](/task/098-task-07)

- 098 Condition previous 1 (Open)

- [098 Task 08 (Open)](/task/098-task-08)

- [098 Task 09 (Open)](/task/098-task-09)

- [098 Task 11 (Open)](/task/098-task-11)

- [098 Task 12 (Open)](/task/098-task-12)

- [098 Task 13 (Open)](/task/098-task-13)

- [098 Task 14 (Open)](/task/098-task-14)

- [098 Task 15 (Open)](/task/098-task-15)'
alpine read /task/parent-098/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 098 (Open)](/task/parent-098).

- [098 Before (Open)](/task/098-before)

- [098 Task 01 (Open)](/task/098-task-01)

- [098 Task 02 (Open)](/task/098-task-02)

- [098 Task 03 (Open)](/task/098-task-03)

- [098 Task 10 (Open)](/task/098-task-10)

- [098 Task 04 (Open)](/task/098-task-04)

- [098 Task 05 (Open)](/task/098-task-05)

- [098 Task 06 (Open)](/task/098-task-06)

- [098 Task 07 (Open)](/task/098-task-07)

- [098 Condition previous 1 (Open)](/task/098-condition-previous-1)

- [098 Task 08 (Open)](/task/098-task-08)

- [098 Task 09 (Open)](/task/098-task-09)

- [098 Task 11 (Open)](/task/098-task-11)

- [098 Task 12 (Open)](/task/098-task-12)

- [098 Task 13 (Open)](/task/098-task-13)

- [098 Task 14 (Open)](/task/098-task-14)

- [098 Task 15 (Open)](/task/098-task-15)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task collection page head; two other adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 099

- 099 Task 01 (Open)
- 099 Task 02 (Open)
- 099 Task 03 (Open)
- 099 Task 04 (Open)
- 099 Task 05 (Open)
- 099 Task 06 (Open)
- 099 Task 07 (Open)
- 099 Task 08 (Open)
- 099 Task 09 (Open)
- 099 Task 10 (Open)
- 099 Task 11 (Open)
- 099 Task 12 (Open)
- 099 Task 13 (Open)
- 099 Task 14 (Open)
- 099 Task 15 (Open)
- 099 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 099](/task-collection/roadmap-099).
`);

    expect(
        await cli.run(`\
alpine read /task-collection/roadmap-099 --limit 850b >/dev/null
alpine update /task-collection/roadmap-099 \\
  --old '- [099 Task 01 (Open)](/task/099-task-01)

- [099 Task 02 (Open)](/task/099-task-02)

- [099 Task 03 (Open)](/task/099-task-03)

- [099 Task 04 (Open)](/task/099-task-04)

- [099 Task 05 (Open)](/task/099-task-05)

- [099 Task 06 (Open)](/task/099-task-06)

- [099 Task 07 (Open)](/task/099-task-07)

- [099 Task 08 (Open)](/task/099-task-08)

- [099 Task 09 (Open)](/task/099-task-09)

- [099 Task 10 (Open)](/task/099-task-10)

- [099 Task 11 (Open)](/task/099-task-11)

- [099 Task 12 (Open)](/task/099-task-12)

- [099 Task 13 (Open)](/task/099-task-13)

- [099 Task 14 (Open)](/task/099-task-14)

- [099 Task 15 (Open)](/task/099-task-15)' \\
  --new '- [099 Task 01 (Open)](/task/099-task-01)

- [099 Task 02 (Open)](/task/099-task-02)

- [099 Task 03 (Open)](/task/099-task-03)

- [099 Task 04 (Open)](/task/099-task-04)

- [099 Task 05 (Open)](/task/099-task-05)

- [099 Task 06 (Open)](/task/099-task-06)

- [099 Task 07 (Open)](/task/099-task-07)

- 099 Condition previous 1 (Open)

- 099 Condition previous 2 (Open)

- [099 Task 08 (Open)](/task/099-task-08)

- [099 Task 09 (Open)](/task/099-task-09)

- [099 Task 10 (Open)](/task/099-task-10)

- [099 Task 11 (Open)](/task/099-task-11)

- [099 Task 12 (Open)](/task/099-task-12)

- [099 Task 13 (Open)](/task/099-task-13)

- [099 Task 14 (Open)](/task/099-task-14)

- [099 Task 15 (Open)](/task/099-task-15)'
alpine update /task-collection/roadmap-099 \\
  --old '- [099 Task 01 (Open)](/task/099-task-01)

- [099 Task 02 (Open)](/task/099-task-02)

- [099 Task 03 (Open)](/task/099-task-03)

- [099 Task 04 (Open)](/task/099-task-04)

- [099 Task 05 (Open)](/task/099-task-05)

- [099 Task 06 (Open)](/task/099-task-06)

- [099 Task 07 (Open)](/task/099-task-07)

- 099 Condition previous 1 (Open)

- 099 Condition previous 2 (Open)

- [099 Task 08 (Open)](/task/099-task-08)

- [099 Task 09 (Open)](/task/099-task-09)

- [099 Task 10 (Open)](/task/099-task-10)

- [099 Task 11 (Open)](/task/099-task-11)

- [099 Task 12 (Open)](/task/099-task-12)

- [099 Task 13 (Open)](/task/099-task-13)

- [099 Task 14 (Open)](/task/099-task-14)

- [099 Task 15 (Open)](/task/099-task-15)' \\
  --new '- [099 Task 01 (Open)](/task/099-task-01)

- [099 Task 02 (Open)](/task/099-task-02)

- [099 Task 03 (Open)](/task/099-task-03)

- [099 Task 10 (Open)](/task/099-task-10)

- [099 Task 04 (Open)](/task/099-task-04)

- [099 Task 05 (Open)](/task/099-task-05)

- [099 Task 06 (Open)](/task/099-task-06)

- [099 Task 07 (Open)](/task/099-task-07)

- 099 Condition previous 1 (Open)

- 099 Condition previous 2 (Open)

- [099 Task 08 (Open)](/task/099-task-08)

- [099 Task 09 (Open)](/task/099-task-09)

- [099 Task 11 (Open)](/task/099-task-11)

- [099 Task 12 (Open)](/task/099-task-12)

- [099 Task 13 (Open)](/task/099-task-13)

- [099 Task 14 (Open)](/task/099-task-14)

- [099 Task 15 (Open)](/task/099-task-15)'
alpine read /task-collection/roadmap-099 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 099

- [099 Task 01 (Open)](/task/099-task-01)

- [099 Task 02 (Open)](/task/099-task-02)

- [099 Task 03 (Open)](/task/099-task-03)

- [099 Task 10 (Open)](/task/099-task-10)

- [099 Task 04 (Open)](/task/099-task-04)

- [099 Task 05 (Open)](/task/099-task-05)

- [099 Task 06 (Open)](/task/099-task-06)

- [099 Task 07 (Open)](/task/099-task-07)

- [099 Condition previous 1 (Open)](/task/099-condition-previous-1)

- [099 Condition previous 2 (Open)](/task/099-condition-previous-2)

- [099 Task 08 (Open)](/task/099-task-08)

- [099 Task 09 (Open)](/task/099-task-09)

- [099 Task 11 (Open)](/task/099-task-11)

- [099 Task 12 (Open)](/task/099-task-12)

- [099 Task 13 (Open)](/task/099-task-13)

- [099 Task 14 (Open)](/task/099-task-14)

- [099 Task 15 (Open)](/task/099-task-15)

- [099 After pagination guard with a deliberately long title (Open)](/task/099-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task collection page tail that is not the end; two other non-adjacent tasks created in the middle in the previous update", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 100

- 100 Before (Open)
- 100 Task 01 (Open)
- 100 Task 02 (Open)
- 100 Task 03 (Open)
- 100 Task 04 (Open)
- 100 Task 05 (Open)
- 100 Task 06 (Open)
- 100 Task 07 (Open)
- 100 Task 08 (Open)
- 100 Task 09 (Open)
- 100 Task 10 (Open)
- 100 Task 11 (Open)
- 100 Task 12 (Open)
- 100 Task 13 (Open)
- 100 Task 14 (Open)
- 100 Task 15 (Open)
- 100 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 100](/task-collection/roadmap-100).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-100 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [100 Task 01 (Open)](/task/100-task-01)

- [100 Task 02 (Open)](/task/100-task-02)

- [100 Task 03 (Open)](/task/100-task-03)

- [100 Task 04 (Open)](/task/100-task-04)

- [100 Task 05 (Open)](/task/100-task-05)

- [100 Task 06 (Open)](/task/100-task-06)

- [100 Task 07 (Open)](/task/100-task-07)

- [100 Task 08 (Open)](/task/100-task-08)

- [100 Task 09 (Open)](/task/100-task-09)

- [100 Task 10 (Open)](/task/100-task-10)

- [100 Task 11 (Open)](/task/100-task-11)

- [100 Task 12 (Open)](/task/100-task-12)

- [100 Task 13 (Open)](/task/100-task-13)

- [100 Task 14 (Open)](/task/100-task-14)

- [100 Task 15 (Open)](/task/100-task-15)' \\
  --new '- [100 Task 01 (Open)](/task/100-task-01)

- [100 Task 02 (Open)](/task/100-task-02)

- [100 Task 03 (Open)](/task/100-task-03)

- [100 Task 04 (Open)](/task/100-task-04)

- [100 Task 05 (Open)](/task/100-task-05)

- [100 Task 06 (Open)](/task/100-task-06)

- 100 Condition previous 1 (Open)

- [100 Task 07 (Open)](/task/100-task-07)

- [100 Task 08 (Open)](/task/100-task-08)

- [100 Task 09 (Open)](/task/100-task-09)

- 100 Condition previous 2 (Open)

- [100 Task 10 (Open)](/task/100-task-10)

- [100 Task 11 (Open)](/task/100-task-11)

- [100 Task 12 (Open)](/task/100-task-12)

- [100 Task 13 (Open)](/task/100-task-13)

- [100 Task 14 (Open)](/task/100-task-14)

- [100 Task 15 (Open)](/task/100-task-15)'
alpine update $path \\
  --old '- [100 Task 01 (Open)](/task/100-task-01)

- [100 Task 02 (Open)](/task/100-task-02)

- [100 Task 03 (Open)](/task/100-task-03)

- [100 Task 04 (Open)](/task/100-task-04)

- [100 Task 05 (Open)](/task/100-task-05)

- [100 Task 06 (Open)](/task/100-task-06)

- 100 Condition previous 1 (Open)

- [100 Task 07 (Open)](/task/100-task-07)

- [100 Task 08 (Open)](/task/100-task-08)

- [100 Task 09 (Open)](/task/100-task-09)

- 100 Condition previous 2 (Open)

- [100 Task 10 (Open)](/task/100-task-10)

- [100 Task 11 (Open)](/task/100-task-11)

- [100 Task 12 (Open)](/task/100-task-12)

- [100 Task 13 (Open)](/task/100-task-13)

- [100 Task 14 (Open)](/task/100-task-14)

- [100 Task 15 (Open)](/task/100-task-15)' \\
  --new '- [100 Task 01 (Open)](/task/100-task-01)

- [100 Task 02 (Open)](/task/100-task-02)

- [100 Task 03 (Open)](/task/100-task-03)

- [100 Task 10 (Open)](/task/100-task-10)

- [100 Task 04 (Open)](/task/100-task-04)

- [100 Task 05 (Open)](/task/100-task-05)

- [100 Task 06 (Open)](/task/100-task-06)

- 100 Condition previous 1 (Open)

- [100 Task 07 (Open)](/task/100-task-07)

- [100 Task 08 (Open)](/task/100-task-08)

- [100 Task 09 (Open)](/task/100-task-09)

- 100 Condition previous 2 (Open)

- [100 Task 11 (Open)](/task/100-task-11)

- [100 Task 12 (Open)](/task/100-task-12)

- [100 Task 13 (Open)](/task/100-task-13)

- [100 Task 14 (Open)](/task/100-task-14)

- [100 Task 15 (Open)](/task/100-task-15)'
alpine read /task-collection/roadmap-100 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
# Roadmap 100

- [100 Before (Open)](/task/100-before)

- [100 Task 01 (Open)](/task/100-task-01)

- [100 Task 02 (Open)](/task/100-task-02)

- [100 Task 03 (Open)](/task/100-task-03)

- [100 Task 10 (Open)](/task/100-task-10)

- [100 Task 04 (Open)](/task/100-task-04)

- [100 Task 05 (Open)](/task/100-task-05)

- [100 Task 06 (Open)](/task/100-task-06)

- [100 Condition previous 1 (Open)](/task/100-condition-previous-1)

- [100 Task 07 (Open)](/task/100-task-07)

- [100 Task 08 (Open)](/task/100-task-08)

- [100 Task 09 (Open)](/task/100-task-09)

- [100 Condition previous 2 (Open)](/task/100-condition-previous-2)

- [100 Task 11 (Open)](/task/100-task-11)

- [100 Task 12 (Open)](/task/100-task-12)

- [100 Task 13 (Open)](/task/100-task-13)

- [100 Task 14 (Open)](/task/100-task-14)

- [100 Task 15 (Open)](/task/100-task-15)

- [100 After pagination guard with a deliberately long title (Open)](/task/100-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task collection page tail at the end; one other existing task moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task-collection '# Roadmap 101

- 101 Before (Open)
- 101 Task 01 (Open)
- 101 Task 02 (Open)
- 101 Task 03 (Open)
- 101 Task 04 (Open)
- 101 Task 05 (Open)
- 101 Task 06 (Open)
- 101 Task 07 (Open)
- 101 Task 08 (Open)
- 101 Task 09 (Open)
- 101 Task 10 (Open)
- 101 Task 11 (Open)
- 101 Task 12 (Open)
- 101 Task 13 (Open)
- 101 Task 14 (Open)
- 101 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task collection: [Roadmap 101](/task-collection/roadmap-101).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task-collection/roadmap-101 --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 100kb >/dev/null
alpine update $path \\
  --old '- [101 Task 01 (Open)](/task/101-task-01)

- [101 Task 02 (Open)](/task/101-task-02)

- [101 Task 03 (Open)](/task/101-task-03)

- [101 Task 04 (Open)](/task/101-task-04)

- [101 Task 05 (Open)](/task/101-task-05)

- [101 Task 06 (Open)](/task/101-task-06)

- [101 Task 07 (Open)](/task/101-task-07)

- [101 Task 08 (Open)](/task/101-task-08)

- [101 Task 09 (Open)](/task/101-task-09)

- [101 Task 10 (Open)](/task/101-task-10)

- [101 Task 11 (Open)](/task/101-task-11)

- [101 Task 12 (Open)](/task/101-task-12)

- [101 Task 13 (Open)](/task/101-task-13)

- [101 Task 14 (Open)](/task/101-task-14)

- [101 Task 15 (Open)](/task/101-task-15)' \\
  --new '- [101 Task 01 (Open)](/task/101-task-01)

- [101 Task 02 (Open)](/task/101-task-02)

- [101 Task 03 (Open)](/task/101-task-03)

- [101 Task 10 (Open)](/task/101-task-10)

- [101 Task 08 (Open)](/task/101-task-08)

- [101 Task 04 (Open)](/task/101-task-04)

- [101 Task 05 (Open)](/task/101-task-05)

- [101 Task 06 (Open)](/task/101-task-06)

- [101 Task 07 (Open)](/task/101-task-07)

- [101 Task 09 (Open)](/task/101-task-09)

- [101 Task 11 (Open)](/task/101-task-11)

- [101 Task 12 (Open)](/task/101-task-12)

- [101 Task 13 (Open)](/task/101-task-13)

- [101 Task 14 (Open)](/task/101-task-14)

- [101 Task 15 (Open)](/task/101-task-15)'
alpine read /task-collection/roadmap-101 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Roadmap 101

- [101 Before (Open)](/task/101-before)

- [101 Task 01 (Open)](/task/101-task-01)

- [101 Task 02 (Open)](/task/101-task-02)

- [101 Task 03 (Open)](/task/101-task-03)

- [101 Task 10 (Open)](/task/101-task-10)

- [101 Task 08 (Open)](/task/101-task-08)

- [101 Task 04 (Open)](/task/101-task-04)

- [101 Task 05 (Open)](/task/101-task-05)

- [101 Task 06 (Open)](/task/101-task-06)

- [101 Task 07 (Open)](/task/101-task-07)

- [101 Task 09 (Open)](/task/101-task-09)

- [101 Task 11 (Open)](/task/101-task-11)

- [101 Task 12 (Open)](/task/101-task-12)

- [101 Task 13 (Open)](/task/101-task-13)

- [101 Task 14 (Open)](/task/101-task-14)

- [101 Task 15 (Open)](/task/101-task-15)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task page subtasks list; two other existing tasks swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 102

## Subtasks

- 102 Task 01 (Open)
- 102 Task 02 (Open)
- 102 Task 03 (Open)
- 102 Task 04 (Open)
- 102 Task 05 (Open)
- 102 Task 06 (Open)
- 102 Task 07 (Open)
- 102 Task 08 (Open)
- 102 Task 09 (Open)
- 102 Task 10 (Open)
- 102 Task 11 (Open)
- 102 Task 12 (Open)
- 102 Task 13 (Open)
- 102 Task 14 (Open)
- 102 Task 15 (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 102](/task/parent-102).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-102 --limit 100kb >/dev/null
alpine update /task/parent-102 \\
  --old '- [102 Task 01 (Open)](/task/102-task-01)

- [102 Task 02 (Open)](/task/102-task-02)

- [102 Task 03 (Open)](/task/102-task-03)

- [102 Task 04 (Open)](/task/102-task-04)

- [102 Task 05 (Open)](/task/102-task-05)

- [102 Task 06 (Open)](/task/102-task-06)

- [102 Task 07 (Open)](/task/102-task-07)

- [102 Task 08 (Open)](/task/102-task-08)

- [102 Task 09 (Open)](/task/102-task-09)

- [102 Task 10 (Open)](/task/102-task-10)

- [102 Task 11 (Open)](/task/102-task-11)

- [102 Task 12 (Open)](/task/102-task-12)

- [102 Task 13 (Open)](/task/102-task-13)

- [102 Task 14 (Open)](/task/102-task-14)

- [102 Task 15 (Open)](/task/102-task-15)' \\
  --new '- [102 Task 01 (Open)](/task/102-task-01)

- [102 Task 02 (Open)](/task/102-task-02)

- [102 Task 03 (Open)](/task/102-task-03)

- [102 Task 10 (Open)](/task/102-task-10)

- [102 Task 04 (Open)](/task/102-task-04)

- [102 Task 05 (Open)](/task/102-task-05)

- [102 Task 06 (Open)](/task/102-task-06)

- [102 Task 09 (Open)](/task/102-task-09)

- [102 Task 08 (Open)](/task/102-task-08)

- [102 Task 07 (Open)](/task/102-task-07)

- [102 Task 11 (Open)](/task/102-task-11)

- [102 Task 12 (Open)](/task/102-task-12)

- [102 Task 13 (Open)](/task/102-task-13)

- [102 Task 14 (Open)](/task/102-task-14)

- [102 Task 15 (Open)](/task/102-task-15)'
alpine read /task/parent-102 --limit 100kb
`),
    ).toEqual(`\
Update was successful.
# Parent 102

- Status: Open

## Subtasks

- [102 Task 01 (Open)](/task/102-task-01)

- [102 Task 02 (Open)](/task/102-task-02)

- [102 Task 03 (Open)](/task/102-task-03)

- [102 Task 10 (Open)](/task/102-task-10)

- [102 Task 04 (Open)](/task/102-task-04)

- [102 Task 05 (Open)](/task/102-task-05)

- [102 Task 06 (Open)](/task/102-task-06)

- [102 Task 09 (Open)](/task/102-task-09)

- [102 Task 08 (Open)](/task/102-task-08)

- [102 Task 07 (Open)](/task/102-task-07)

- [102 Task 11 (Open)](/task/102-task-11)

- [102 Task 12 (Open)](/task/102-task-12)

- [102 Task 13 (Open)](/task/102-task-13)

- [102 Task 14 (Open)](/task/102-task-14)

- [102 Task 15 (Open)](/task/102-task-15)
`);
});

test("one existing task to the top third from the bottom third; task subtasks page head; one other link-less task from the previous update moved in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 103

## Subtasks

- 103 Task 01 (Open)
- 103 Task 02 (Open)
- 103 Task 03 (Open)
- 103 Task 04 (Open)
- 103 Task 05 (Open)
- 103 Task 06 (Open)
- 103 Task 07 (Open)
- 103 Task 08 (Open)
- 103 Task 09 (Open)
- 103 Task 10 (Open)
- 103 Task 11 (Open)
- 103 Task 12 (Open)
- 103 Task 13 (Open)
- 103 Task 14 (Open)
- 103 Task 15 (Open)
- 103 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 103](/task/parent-103).
`);

    expect(
        await cli.run(`\
alpine read /task/parent-103/subtasks --limit 850b >/dev/null
alpine update /task/parent-103/subtasks \\
  --old '- [103 Task 01 (Open)](/task/103-task-01)

- [103 Task 02 (Open)](/task/103-task-02)

- [103 Task 03 (Open)](/task/103-task-03)

- [103 Task 04 (Open)](/task/103-task-04)

- [103 Task 05 (Open)](/task/103-task-05)

- [103 Task 06 (Open)](/task/103-task-06)

- [103 Task 07 (Open)](/task/103-task-07)

- [103 Task 08 (Open)](/task/103-task-08)

- [103 Task 09 (Open)](/task/103-task-09)

- [103 Task 10 (Open)](/task/103-task-10)

- [103 Task 11 (Open)](/task/103-task-11)

- [103 Task 12 (Open)](/task/103-task-12)

- [103 Task 13 (Open)](/task/103-task-13)

- [103 Task 14 (Open)](/task/103-task-14)

- [103 Task 15 (Open)](/task/103-task-15)' \\
  --new '- [103 Task 01 (Open)](/task/103-task-01)

- [103 Task 02 (Open)](/task/103-task-02)

- [103 Task 03 (Open)](/task/103-task-03)

- [103 Task 04 (Open)](/task/103-task-04)

- [103 Task 05 (Open)](/task/103-task-05)

- [103 Task 06 (Open)](/task/103-task-06)

- [103 Task 07 (Open)](/task/103-task-07)

- 103 Condition previous 1 (Open)

- [103 Task 08 (Open)](/task/103-task-08)

- [103 Task 09 (Open)](/task/103-task-09)

- [103 Task 10 (Open)](/task/103-task-10)

- [103 Task 11 (Open)](/task/103-task-11)

- [103 Task 12 (Open)](/task/103-task-12)

- [103 Task 13 (Open)](/task/103-task-13)

- [103 Task 14 (Open)](/task/103-task-14)

- [103 Task 15 (Open)](/task/103-task-15)'
alpine update /task/parent-103/subtasks \\
  --old '- [103 Task 01 (Open)](/task/103-task-01)

- [103 Task 02 (Open)](/task/103-task-02)

- [103 Task 03 (Open)](/task/103-task-03)

- [103 Task 04 (Open)](/task/103-task-04)

- [103 Task 05 (Open)](/task/103-task-05)

- [103 Task 06 (Open)](/task/103-task-06)

- [103 Task 07 (Open)](/task/103-task-07)

- 103 Condition previous 1 (Open)

- [103 Task 08 (Open)](/task/103-task-08)

- [103 Task 09 (Open)](/task/103-task-09)

- [103 Task 10 (Open)](/task/103-task-10)

- [103 Task 11 (Open)](/task/103-task-11)

- [103 Task 12 (Open)](/task/103-task-12)

- [103 Task 13 (Open)](/task/103-task-13)

- [103 Task 14 (Open)](/task/103-task-14)

- [103 Task 15 (Open)](/task/103-task-15)' \\
  --new '- [103 Task 01 (Open)](/task/103-task-01)

- [103 Task 02 (Open)](/task/103-task-02)

- [103 Task 03 (Open)](/task/103-task-03)

- [103 Task 10 (Open)](/task/103-task-10)

- 103 Condition previous 1 (Open)

- [103 Task 04 (Open)](/task/103-task-04)

- [103 Task 05 (Open)](/task/103-task-05)

- [103 Task 06 (Open)](/task/103-task-06)

- [103 Task 07 (Open)](/task/103-task-07)

- [103 Task 08 (Open)](/task/103-task-08)

- [103 Task 09 (Open)](/task/103-task-09)

- [103 Task 11 (Open)](/task/103-task-11)

- [103 Task 12 (Open)](/task/103-task-12)

- [103 Task 13 (Open)](/task/103-task-13)

- [103 Task 14 (Open)](/task/103-task-14)

- [103 Task 15 (Open)](/task/103-task-15)'
alpine read /task/parent-103/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 103 (Open)](/task/parent-103).

- [103 Task 01 (Open)](/task/103-task-01)

- [103 Task 02 (Open)](/task/103-task-02)

- [103 Task 03 (Open)](/task/103-task-03)

- [103 Task 10 (Open)](/task/103-task-10)

- [103 Condition previous 1 (Open)](/task/103-condition-previous-1)

- [103 Task 04 (Open)](/task/103-task-04)

- [103 Task 05 (Open)](/task/103-task-05)

- [103 Task 06 (Open)](/task/103-task-06)

- [103 Task 07 (Open)](/task/103-task-07)

- [103 Task 08 (Open)](/task/103-task-08)

- [103 Task 09 (Open)](/task/103-task-09)

- [103 Task 11 (Open)](/task/103-task-11)

- [103 Task 12 (Open)](/task/103-task-12)

- [103 Task 13 (Open)](/task/103-task-13)

- [103 Task 14 (Open)](/task/103-task-14)

- [103 Task 15 (Open)](/task/103-task-15)

- [103 After pagination guard with a deliberately long title (Open)](/task/103-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});

test("one existing task to the top third from the bottom third; task subtasks page tail that is not the end; two other link-less tasks from the previous update swapped in the middle", async () => {
    expect(
        await cli.run(`\
alpine create task '# Parent 104

## Subtasks

- 104 Before (Open)
- 104 Task 01 (Open)
- 104 Task 02 (Open)
- 104 Task 03 (Open)
- 104 Task 04 (Open)
- 104 Task 05 (Open)
- 104 Task 06 (Open)
- 104 Task 07 (Open)
- 104 Task 08 (Open)
- 104 Task 09 (Open)
- 104 Task 10 (Open)
- 104 Task 11 (Open)
- 104 Task 12 (Open)
- 104 Task 13 (Open)
- 104 Task 14 (Open)
- 104 Task 15 (Open)
- 104 After pagination guard with a deliberately long title (Open)'
`),
    ).toEqual(`\
Create was successful. New task: [Parent 104](/task/parent-104).
`);

    expect(
        await cli.run(`\
page="$(alpine read /task/parent-104/subtasks --limit 160b)"
path="$(printf '%s' "$page" | sed -n '/Next page »/ { s/.*Next page »](//; s/).*//; p; }')"
alpine read "$path" --limit 850b >/dev/null
alpine update $path \\
  --old '- [104 Task 01 (Open)](/task/104-task-01)

- [104 Task 02 (Open)](/task/104-task-02)

- [104 Task 03 (Open)](/task/104-task-03)

- [104 Task 04 (Open)](/task/104-task-04)

- [104 Task 05 (Open)](/task/104-task-05)

- [104 Task 06 (Open)](/task/104-task-06)

- [104 Task 07 (Open)](/task/104-task-07)

- [104 Task 08 (Open)](/task/104-task-08)

- [104 Task 09 (Open)](/task/104-task-09)

- [104 Task 10 (Open)](/task/104-task-10)

- [104 Task 11 (Open)](/task/104-task-11)

- [104 Task 12 (Open)](/task/104-task-12)

- [104 Task 13 (Open)](/task/104-task-13)

- [104 Task 14 (Open)](/task/104-task-14)

- [104 Task 15 (Open)](/task/104-task-15)' \\
  --new '- [104 Task 01 (Open)](/task/104-task-01)

- [104 Task 02 (Open)](/task/104-task-02)

- [104 Task 03 (Open)](/task/104-task-03)

- [104 Task 04 (Open)](/task/104-task-04)

- [104 Task 05 (Open)](/task/104-task-05)

- [104 Task 06 (Open)](/task/104-task-06)

- 104 Condition previous 1 (Open)

- [104 Task 07 (Open)](/task/104-task-07)

- [104 Task 08 (Open)](/task/104-task-08)

- [104 Task 09 (Open)](/task/104-task-09)

- 104 Condition previous 2 (Open)

- [104 Task 10 (Open)](/task/104-task-10)

- [104 Task 11 (Open)](/task/104-task-11)

- [104 Task 12 (Open)](/task/104-task-12)

- [104 Task 13 (Open)](/task/104-task-13)

- [104 Task 14 (Open)](/task/104-task-14)

- [104 Task 15 (Open)](/task/104-task-15)'
alpine update $path \\
  --old '- [104 Task 01 (Open)](/task/104-task-01)

- [104 Task 02 (Open)](/task/104-task-02)

- [104 Task 03 (Open)](/task/104-task-03)

- [104 Task 04 (Open)](/task/104-task-04)

- [104 Task 05 (Open)](/task/104-task-05)

- [104 Task 06 (Open)](/task/104-task-06)

- 104 Condition previous 1 (Open)

- [104 Task 07 (Open)](/task/104-task-07)

- [104 Task 08 (Open)](/task/104-task-08)

- [104 Task 09 (Open)](/task/104-task-09)

- 104 Condition previous 2 (Open)

- [104 Task 10 (Open)](/task/104-task-10)

- [104 Task 11 (Open)](/task/104-task-11)

- [104 Task 12 (Open)](/task/104-task-12)

- [104 Task 13 (Open)](/task/104-task-13)

- [104 Task 14 (Open)](/task/104-task-14)

- [104 Task 15 (Open)](/task/104-task-15)' \\
  --new '- [104 Task 01 (Open)](/task/104-task-01)

- [104 Task 02 (Open)](/task/104-task-02)

- [104 Task 03 (Open)](/task/104-task-03)

- [104 Task 10 (Open)](/task/104-task-10)

- [104 Task 04 (Open)](/task/104-task-04)

- [104 Task 05 (Open)](/task/104-task-05)

- [104 Task 06 (Open)](/task/104-task-06)

- 104 Condition previous 2 (Open)

- [104 Task 07 (Open)](/task/104-task-07)

- [104 Task 08 (Open)](/task/104-task-08)

- [104 Task 09 (Open)](/task/104-task-09)

- 104 Condition previous 1 (Open)

- [104 Task 11 (Open)](/task/104-task-11)

- [104 Task 12 (Open)](/task/104-task-12)

- [104 Task 13 (Open)](/task/104-task-13)

- [104 Task 14 (Open)](/task/104-task-14)

- [104 Task 15 (Open)](/task/104-task-15)'
alpine read /task/parent-104/subtasks --limit 100kb
`),
    ).toEqual(`\
Update was successful.
Update was successful.
Subtasks for [Parent 104 (Open)](/task/parent-104).

- [104 Before (Open)](/task/104-before)

- [104 Task 01 (Open)](/task/104-task-01)

- [104 Task 02 (Open)](/task/104-task-02)

- [104 Task 03 (Open)](/task/104-task-03)

- [104 Task 10 (Open)](/task/104-task-10)

- [104 Task 04 (Open)](/task/104-task-04)

- [104 Task 05 (Open)](/task/104-task-05)

- [104 Task 06 (Open)](/task/104-task-06)

- [104 Condition previous 2 (Open)](/task/104-condition-previous-2)

- [104 Task 07 (Open)](/task/104-task-07)

- [104 Task 08 (Open)](/task/104-task-08)

- [104 Task 09 (Open)](/task/104-task-09)

- [104 Condition previous 1 (Open)](/task/104-condition-previous-1)

- [104 Task 11 (Open)](/task/104-task-11)

- [104 Task 12 (Open)](/task/104-task-12)

- [104 Task 13 (Open)](/task/104-task-13)

- [104 Task 14 (Open)](/task/104-task-14)

- [104 Task 15 (Open)](/task/104-task-15)

- [104 After pagination guard with a deliberately long title (Open)](/task/104-after-pagination-guard-with-a-deliberatel)

End of tasks.
`);
});
