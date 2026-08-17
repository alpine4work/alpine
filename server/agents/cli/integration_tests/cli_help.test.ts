/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.open_source.js";

const cli = setupCliForTest();

const expectedHelpBeginning = `\
# Alpine CLI

Usage:

\`\`\`
alpine read <path> [--limit 20kb]
alpine update <path> --old "..." --new "..."
alpine create <type> <content>
alpine delete <path>
alpine search <query> [--limit 10]
alpine scroll <path> --offset 0 [--limit 20kb]
alpine find <path> <pattern> [--offset 0] [--limit 5] [--match-limit 4kb]
\`\`\`

[Alpine](https://alpine.inc) is an all-in-one productivity suite`;

const expectedHelpMiddle = `\
| [Spaces](/skill/spaces) | \`/space\` | | |

(You can call the \`read\` tool with the above skill links to read the skill, e.g. \`alpine read /skill/documents\`.)

## Tips

### Searching`;

const expectedHelpEnding = `\
- If you\u2019re talking with people somewhere that everyone in the space can access then you can only see things that everyone in the space can access.

### Stdin

When creating large pages, you can pass \`-\` to \`alpine create\` (e.g. \`alpine create document -\`) and pipe content to stdin instead of writing the content inline in the command.

Similarly, when adding a lot of content in an update, you can pass \`-\` to \`alpine update\` (as both the \`--old\` and \`--new\` args, e.g. \`alpine update --old - --new -\`) and pipe update(s) to stdin. Updates should be a JSON object (or an array of JSON objects) with the properties \`old\` and \`new\`.
`;

const expectedHelpPattern = new RegExp(
    `^${escapeRegExp(expectedHelpBeginning)}[\\s\\S]*${escapeRegExp(expectedHelpMiddle)}[\\s\\S]*${escapeRegExp(expectedHelpEnding)}$`,
);

test("show help when no command is provided", async () => {
    expect(await cli.run("alpine")).toEqual(expect.stringMatching(expectedHelpPattern));
});

test("show help with the help command", async () => {
    expect(await cli.run("alpine help")).toEqual(expect.stringMatching(expectedHelpPattern));
});

test("show help with the long help flag", async () => {
    expect(await cli.run("alpine --help")).toEqual(expect.stringMatching(expectedHelpPattern));
});

test("show help with the short help flag", async () => {
    expect(await cli.run("alpine -h")).toEqual(expect.stringMatching(expectedHelpPattern));
});

test("read a skill linked from help", async () => {
    expect(await cli.run("alpine read /skill/create")).toContain(
        "To create something in Alpine, pass one of the listed `type`s below",
    );
});

test("read a second skill with different documentation", async () => {
    expect(await cli.run("alpine read /skill/accounts")).toContain(`\
# Accounts

An account represents some actor in Alpine. Either a human (who logs in with an email address) or a bot. You will access Alpine through a bot account (you can find the path to your account with \`/bot/me\`).
`);
});

test("reject updates to a read-only skill", async () => {
    expect(await cli.run("alpine read /skill/create")).toContain(
        "To create something in Alpine, pass one of the listed `type`s below",
    );

    expect(
        await cli.run(
            "alpine update /skill/create --old '# What can you create in Alpine?' --new '# What can agents create in Alpine?'",
        ),
    ).toEqual(`\
Error: Couldn\u2019t update \`/skill/create\`. Can\u2019t update a \`/skill/...\` page. Skills are read-only documentation written by the Alpine team to help you, the agent, navigate and update context in Alpine. If you think there\u2019s a mistake in a skill, please reach out to support@alpine.inc.
`);
});

test("show a useful error when reading a skill that does not exist", async () => {
    expect(await cli.run("alpine read /skill/does-not-exist")).toEqual(`\
Error: Couldn\u2019t read \`/skill/does-not-exist\`. Nothing found for path \`/skill/does-not-exist\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.
`);
});
