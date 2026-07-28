/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest();

const expectedHelpBeginning = `\
# Alpine CLI

Usage:

\`\`\`
alpine read <path> [--limit 20kb]
alpine create <type> <content>
alpine update <path> --old "..." --new "..."
alpine delete <path>
alpine search <query>
alpine scroll <path> --offset 0 [--limit 20kb]
alpine find <path> <pattern> [--offset 0] [--limit 4kb] [--match-limit 5]
\`\`\`

[Alpine](https://alpine.inc) is an all-in-one productivity suite`;

const expectedHelpMiddle = `\
| [Spaces](/skill/spaces) | \`/space\` | |

(You can call the \`read\` tool with the above skill links to read the skill, e.g. \`alpine read /skill/documents\`.)

## Tips

### Updating`;

const expectedHelpEnding = `\
- If you\u2019re talking with people somewhere that everyone in the space can access then you can only see things that everyone in the space can access.

### Stdin

When creating large pages, you can pass \`-\` to \`alpine create\` (e.g. \`alpine create document -\`) and pipe content to stdin instead of writing the content inline in the command.

Similarly, when adding a lot of content in an update, you can pass \`-\` to \`alpine update\` (as both the \`--old\` and \`--new\` args, e.g. \`alpine update --old - --new -\`) and pipe update(s) to stdin. Updates should be a JSON object (or an array of JSON objects) with the properties \`old\` and \`new\`.
`;

test("show help when no command is provided", async () => {
    const output = await cli.run("alpine");

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we start with the contained string.
    expect(output).toContain(expectedHelpBeginning);
    expect(output.startsWith(expectedHelpBeginning)).toBe(true);

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we end with the contained string.
    expect(output).toContain(expectedHelpEnding);
    expect(output.endsWith(expectedHelpEnding)).toBe(true);

    expect(output).toContain(expectedHelpMiddle);
});

test("show help with the help command", async () => {
    const output = await cli.run("alpine help");

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we start with the contained string.
    expect(output).toContain(expectedHelpBeginning);
    expect(output.startsWith(expectedHelpBeginning)).toBe(true);

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we end with the contained string.
    expect(output).toContain(expectedHelpEnding);
    expect(output.endsWith(expectedHelpEnding)).toBe(true);

    expect(output).toContain(expectedHelpMiddle);
});

test("show help with the long help flag", async () => {
    const output = await cli.run("alpine --help");

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we start with the contained string.
    expect(output).toContain(expectedHelpBeginning);
    expect(output.startsWith(expectedHelpBeginning)).toBe(true);

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we end with the contained string.
    expect(output).toContain(expectedHelpEnding);
    expect(output.endsWith(expectedHelpEnding)).toBe(true);

    expect(output).toContain(expectedHelpMiddle);
});

test("show help with the short help flag", async () => {
    const output = await cli.run("alpine -h");

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we start with the contained string.
    expect(output).toContain(expectedHelpBeginning);
    expect(output.startsWith(expectedHelpBeginning)).toBe(true);

    // Nice `expect().toContain()` error message first which will show us a pretty diff
    // and then make sure we end with the contained string.
    expect(output).toContain(expectedHelpEnding);
    expect(output.endsWith(expectedHelpEnding)).toBe(true);

    expect(output).toContain(expectedHelpMiddle);
});

test("read a skill linked from help", async () => {
    expect(await cli.run("alpine read /skill/create")).toContain(
        "To create something in Alpine, pass one of the listed `type`s below",
    );
});

test("show a useful error when reading a skill that does not exist", async () => {
    expect(await cli.run("alpine read /skill/does-not-exist")).toEqual(`\
Error: Couldn\u2019t read \`/skill/does-not-exist\`. Nothing found for path \`/skill/does-not-exist\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.
`);
});
