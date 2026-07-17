/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";

const cli = setupCliForTest();

test("create document", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube launch

YouTube launched on February 14, 2005.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube launch](/document/youtube-launch).
`);
});

test("create document from stdin", async () => {
    await cli.run(`printf '%s' '# YouTube stdin creation

YouTube was created from stdin.' | alpine create document -`);

    expect(await cli.run("alpine read /document/youtube-stdin-creation")).toEqual(`\
# YouTube stdin creation

YouTube was created from stdin.
`);
});

test("read document created by the CLI", async () => {
    await cli.run(`\
alpine create document '# YouTube overview

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California.'
`);

    expect(await cli.run("alpine read /document/youtube-overview")).toEqual(`\
# YouTube overview

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California.
`);
});

test("search for and read document created by a test helper", async () => {
    await TestDocument.create(cli.session, {
        title: "Me at the zoo",
        body: "The first video, “Me at the zoo,” was uploaded on April 23, 2005.",
        access: "Public",
    });

    // New documents are indexed after the production document-indexing throttle.
    //
    // NOCOMMIT: Uh oh! Not good!
    await new Promise(resolve => setTimeout(resolve, 10 * 1000));

    expect(await cli.run("alpine search 'Me zoo'")).toEqual(`\
1. [Me at the zoo](/document/me-at-the-zoo)

   The first video, “**Me** at the **zoo**,” was uploaded on April 23, 2005.
`);

    expect(await cli.run("alpine read /document/me-at-the-zoo")).toEqual(`\
# Me at the zoo

The first video, “Me at the zoo,” was uploaded on April 23, 2005.
`);
});

test("scroll document", async () => {
    await cli.run(`\
alpine create document '# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.'
`);

    await cli.run("alpine read /document/youtube-acquisition");

    expect(await cli.run("alpine scroll /document/youtube-acquisition --offset 2")).toEqual(`\
Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.

(End of file. Showing lines 3-5 of 5.)
`);
});

test("scroll document with offset positioned before path", async () => {
    await cli.run(`\
alpine create document '# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.'
`);

    await cli.run("alpine read /document/youtube-acquisition");

    expect(await cli.run("alpine scroll --offset ' 2 ' /document/youtube-acquisition")).toEqual(`\
Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.

(End of file. Showing lines 3-5 of 5.)
`);
});

test("find in document", async () => {
    await cli.run(`\
alpine create document '# YouTube founders

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim.'
`);

    await cli.run("alpine read /document/youtube-founders");

    expect(await cli.run("alpine find /document/youtube-founders 'Jawed Karim' --match-limit=80b"))
        .toEqual(`\
Found 1 match.

<match>

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim.

(Showing line 3.)

</match>
`);
});

test("update document", async () => {
    await cli.run(`\
alpine create document '# YouTube advertising revenue

YouTube’s annual advertising revenue increased to $28.8 billion in 2021.'
`);

    await cli.run("alpine read /document/youtube-advertising-revenue");

    expect(
        await cli.run("alpine update /document/youtube-advertising-revenue --old 2021 --new 2022"),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /document/youtube-advertising-revenue")).toEqual(
        `\
# YouTube advertising revenue

YouTube’s annual advertising revenue increased to $28.8 billion in 2022.
`,
    );
});

test("update document multiple times", async () => {
    await cli.run(`\
alpine create document '# Multiple YouTube updates

YouTube has an old title and an old description.'
`);

    await cli.run(
        "alpine update /document/multiple-youtube-updates --old 'old title' --new 'updated title' --old 'old description' --new 'updated description'",
    );

    expect(await cli.run("alpine read /document/multiple-youtube-updates")).toEqual(`\
# Multiple YouTube updates

YouTube has an updated title and an updated description.
`);
});

test("update document with multiple nominal arguments in unusual orders", async () => {
    await cli.run(`\
alpine create document '# Unusually ordered YouTube updates

YouTube repeats one one and two two.'
`);

    await cli.run(
        "alpine update --replace-all --new=ONE --old one --old=two --new TWO /document/unusually-ordered-youtube-updates",
    );

    expect(await cli.run("alpine read /document/unusually-ordered-youtube-updates")).toEqual(`\
# Unusually ordered YouTube updates

YouTube repeats ONE ONE and TWO TWO.
`);
});

test("update document from stdin", async () => {
    await cli.run(`\
alpine create document '# YouTube stdin update

YouTube repeats one one and then two.'
`);

    await cli.run(
        `printf '%s' '[{"old":"one","new":"ONE","replace-all":true},{"old":"two","new":"TWO"}]' | alpine update /document/youtube-stdin-update --old - --old - --new - --new -`,
    );

    expect(await cli.run("alpine read /document/youtube-stdin-update")).toEqual(`\
# YouTube stdin update

YouTube repeats ONE ONE and then TWO.
`);
});

test.each([
    {
        command: "alpine create",
        argName: "type",
        syntax: "alpine create <type> <content>",
    },
    {
        command: "alpine create document",
        argName: "content",
        syntax: "alpine create <type> <content>",
    },
    {
        command: "alpine read",
        argName: "path",
        syntax: "alpine read <path> [--limit ...]",
    },
    {
        command: "alpine update",
        argName: "path",
        syntax: "alpine update <path> [--old ...] [--new ...] [--replace-all]",
    },
    {
        command: "alpine scroll",
        argName: "path",
        syntax: "alpine scroll <path> --offset <...> [--limit ...]",
    },
    {
        command: "alpine find",
        argName: "path",
        syntax: "alpine find <path> <pattern> [--offset ...] [--limit ...] [--match-limit ...]",
    },
    {
        command: "alpine find /document/example",
        argName: "pattern",
        syntax: "alpine find <path> <pattern> [--offset ...] [--limit ...] [--match-limit ...]",
    },
    {
        command: "alpine search",
        argName: "query",
        syntax: "alpine search <query>",
    },
])("rejects a missing required $argName argument", async ({command, argName, syntax}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Missing required \`<${argName}>\` arg. Try again but add the \`<${argName}>\` arg. Expected syntax: \`${syntax}\`.\n`,
    );
});

test.each([
    {
        command: "alpine search query extra",
        countMessage: "1 unused arg",
    },
    {
        command: "alpine search query extra1 extra2",
        countMessage: "2 unused args",
    },
])("rejects $countMessage", async ({command, countMessage}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Unexpected args. Try again but remove the ${countMessage}. Expected syntax: \`alpine search <query>\`.\n`,
    );
});

test.each([
    {
        name: "value then equals",
        command: "alpine read /document/example --limit 1kb --limit=2kb",
    },
    {
        name: "equals then value",
        command: "alpine read /document/example --limit=1kb --limit 2kb",
    },
])("rejects a duplicate nominal argument using $name syntax", async ({command}) => {
    await expect(cli.run(command)).resolves.toEqual(
        "Error: Couldn\u2019t run command. There\u2019s more than one `--limit` args. Try again with only one `--limit` arg. Expected syntax: `alpine read <path> [--limit ...]`.\n",
    );
});

test("rejects a missing required nominal argument", async () => {
    await expect(cli.run("alpine scroll /document/example")).resolves.toEqual(
        "Error: Couldn\u2019t run command. Missing required `--offset` arg. Try again but add the `--offset` arg. Expected syntax: `alpine scroll <path> --offset <...> [--limit ...]`.\n",
    );
});

test("rejects an unknown nominal argument", async () => {
    await expect(cli.run("alpine read /document/example --unknown=value")).resolves.toEqual(
        "Error: Couldn\u2019t run command. Unrecognized `--unknown` arg. Try again without the `--unknown` arg. Expected syntax: `alpine read <path> [--limit ...]`.\n",
    );
});

test("rejects an update without an old argument", async () => {
    await expect(cli.run("alpine update /document/example")).resolves.toEqual(
        "Error: Couldn\u2019t run command. Missing required `--old` arg. Try again but add the `--old` arg. Expected syntax: `alpine update <path> [--old ...] [--new ...] [--replace-all]`.\n",
    );
});

test("rejects an update without a new argument", async () => {
    await expect(cli.run("alpine update /document/example --old=before")).resolves.toEqual(
        "Error: Couldn\u2019t run command. Missing required `--new` arg. Try again but add the `--new` arg. Expected syntax: `alpine update <path> [--old ...] [--new ...] [--replace-all]`.\n",
    );
});

test.each([
    {
        name: "one old argument",
        command: "alpine update /document/example --old=before --new=after --new=extra",
        countMessage: "1 more `--old` arg",
    },
    {
        name: "multiple old arguments",
        command:
            "alpine update /document/example --old=before --new=after --new=extra1 --new=extra2",
        countMessage: "2 more `--old` args",
    },
])("rejects an update missing $name", async ({command, countMessage}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Must provide an \`--old\` arg for every \`--new\` arg. Try again but with ${countMessage}.\n`,
    );
});

test.each([
    {
        name: "one new argument",
        command: "alpine update /document/example --old=before --old=extra --new=after",
        countMessage: "1 more `--new` arg",
    },
    {
        name: "multiple new arguments",
        command:
            "alpine update /document/example --old=before --old=extra1 --old=extra2 --new=after",
        countMessage: "2 more `--new` args",
    },
])("rejects an update missing $name", async ({command, countMessage}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Must provide a \`--new\` arg for every \`--old\` arg. Try again but with ${countMessage}.\n`,
    );
});

test.each([
    {
        name: "old",
        command: "alpine update /document/example --old=- --new=after",
    },
    {
        name: "new",
        command: "alpine update /document/example --old=before --new=-",
    },
])("rejects stdin requested only for the $name update value", async ({command}) => {
    await expect(cli.run(command)).resolves.toEqual(
        "Error: Couldn\u2019t run command. If one of an `--old` arg or `--new` arg is `-` that means updates will be read from stdin. Try again but make sure every `--old` arg and `--new` arg use `-` to proceed with reading updates from stdin.\n",
    );
});

test.each([
    {name: "malformed JSON", stdin: "{"},
    {name: "a non-array top-level value", stdin: "{}"},
    {name: "a non-object update", stdin: "[null]"},
    {
        name: "an unexpected property",
        stdin: '[{"old":"before","new":"after","extra":true}]',
    },
    {
        name: "a non-boolean replace-all property",
        stdin: '[{"old":"before","new":"after","replace-all":"yes"}]',
    },
    {name: "a missing old property", stdin: '[{"new":"after"}]'},
    {name: "a non-string old property", stdin: '[{"old":1,"new":"after"}]'},
    {name: "a missing new property", stdin: '[{"old":"before"}]'},
    {name: "a non-string new property", stdin: '[{"old":"before","new":1}]'},
])("rejects update stdin containing $name", async ({stdin}) => {
    await expect(
        cli.run(`printf '%s' '${stdin}' | alpine update /document/example --old - --new -`),
    ).resolves.toEqual(
        "Error: Couldn\u2019t run command. Invalid update JSON from stdin. Update JSON must be an array of objects with `old` and `new` string properties. Optionally a `replace-all` boolean property as well. Try again with a valid JSON array of updates written to stdin.\n",
    );
});

test.each([
    {
        name: "a negative integer",
        command: "alpine scroll /document/example --offset=-1",
        argName: "offset",
        value: "-1",
    },
    {
        name: "a leading zero",
        command: "alpine scroll /document/example --offset=01",
        argName: "offset",
        value: "01",
    },
    {
        name: "a decimal",
        command: "alpine scroll /document/example --offset=1.5",
        argName: "offset",
        value: "1.5",
    },
    {
        name: "an unsafe integer",
        command: "alpine scroll /document/example --offset=9007199254740992",
        argName: "offset",
        value: "9007199254740992",
    },
    {
        name: "an empty value",
        command: "alpine scroll /document/example --offset='   '",
        argName: "offset",
        value: "",
    },
    {
        name: "a non-integer find limit",
        command: "alpine find /document/example pattern --limit=nope",
        argName: "limit",
        value: "nope",
    },
])("rejects $name", async ({command, argName, value}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t parse non-negative integer from: \`${value}\`. Try again with zero or a positive integer for the \`--${argName}\` arg.\n`,
    );
});

test.each([
    {
        command: "alpine unknown",
        subcommand: "unknown",
    },
    {
        command: "alpine",
        subcommand: "",
    },
])("rejects subcommand `$subcommand`", async ({command, subcommand}) => {
    await expect(cli.run(command)).resolves.toEqual(
        `Error: Couldn\u2019t run command. Unknown subcommand: \`${subcommand}\`. Try again with one of \`create\`, \`read\`, \`update\`, or \`search\`.\n`,
    );
});

test("rejects a data path whose directory cannot be created", async () => {
    await expect(
        cli.run("ALPINE_DATA_PATH=/dev/null/alpine-cli-test alpine read /document/example"),
    ).resolves.toEqual(
        "Error: Couldn\u2019t run command. Couldn\u2019t create data directory at `/dev/null/alpine-cli-test`. Try changing the `ALPINE_DATA_PATH` environment variable to a location you can write to.\n",
    );
});

test.each([
    {
        name: "a missing auth file",
        dataDirectorySuffix: "missing-auth-file",
        authContents: undefined,
    },
    {
        name: "an invalid auth file",
        dataDirectorySuffix: "invalid-auth-file",
        authContents: "invalid",
    },
])("rejects $name", async ({dataDirectorySuffix, authContents}) => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-${dataDirectorySuffix}`;
    const writeAuthCommand =
        authContents === undefined ? "" : `printf '%s' '${authContents}' > "$data_path/auth.json"`;

    await expect(
        cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
${writeAuthCommand}
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).resolves.toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t read \`auth.json\` from \`${dataDirectoryPath}\`.\n`,
    );
});

test("rejects an auth file without an API key", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-missing-api-key`;

    await expect(
        cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
printf '%s' '{}' > "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).resolves.toEqual(
        "Error: Couldn\u2019t run command. Couldn\u2019t find an `apiKey` property in `auth.json`.\n",
    );
});

test("rejects a data path whose database cannot be opened", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-invalid-database`;

    await expect(
        cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
cp "$ALPINE_DATA_PATH/auth.json" "$data_path/auth.json"
mkdir "$data_path/agents-web.db"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).resolves.toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t open the database in \`${dataDirectoryPath}\`. Maybe you can\u2019t write to \`${dataDirectoryPath}\`? Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.\n`,
    );
});

test("rejects an unreachable auth API", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-unreachable-auth-api`;

    await expect(
        cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
sed -E 's/,"authResponse":.*$/}/' "$ALPINE_DATA_PATH/auth.json" > "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" ALPINE_API_URL=http://127.0.0.1:1 alpine read /document/example`),
    ).resolves.toEqual(
        "Error: Couldn\u2019t run command. Couldn\u2019t get the current bot from the API. Make sure you\u2019re online and can reach `http://127.0.0.1:1/auth`.\n",
    );
});

test("rejects an auth file that cannot be updated", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-readonly-auth-file`;

    await expect(
        cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
sed -E 's/,"authResponse":.*$/}/' "$ALPINE_DATA_PATH/auth.json" > "$data_path/auth.json"
chmod 400 "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).resolves.toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t write \`auth.json\` to \`${dataDirectoryPath}\`. Try again after confirming the user running this CLI is allowed to write to \`${dataDirectoryPath}\`.\n`,
    );
});
