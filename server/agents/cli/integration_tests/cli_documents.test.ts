/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {processIndexSearchEntityJob} from "~/server/search/data/index/search_entity_index.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const cli = setupCliForTest();

// Documents are indexed on a delay. We can call this in tests to immediately index
// a document in search so it's visible to CLI commands like `alpine search`.
// Generally prefer calling `context.services.waitForSqsProcessJobs()` instead when
// you know a search job has been queued (which is most of the time).
async function indexDocumentSearchEntityImmediately(document: TestDocument) {
    await testTracer.withSpan("Process job document IndexSearchEntity immediately", async span => {
        await processIndexSearchEntityJob(
            cli.space.systemAction(),
            {
                type: "IndexSearchEntity",
                spaceId: document.space.id,
                update: {
                    type: "Document",
                    documentId: document.id,
                    updatedTraits: {type: "Any"},
                },
            },
            new Date(),
            span,
        );
    });
}

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
    expect(
        await cli.run(`printf '%s' '# YouTube stdin creation

YouTube was created from stdin.' | alpine create document -`),
    ).toEqual(`\
Create was successful. New document: [YouTube stdin creation](/document/youtube-stdin-creation).
`);

    expect(await cli.run("alpine read /document/youtube-stdin-creation")).toEqual(`\
# YouTube stdin creation

YouTube was created from stdin.
`);
});

test("read document created by the CLI", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube overview

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube overview](/document/youtube-overview).
`);

    expect(await cli.run("alpine read /document/youtube-overview")).toEqual(`\
# YouTube overview

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California.
`);
});

test("read document from a URL with localhost syntax", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "YouTube URL overview",
        body: "YouTube is an American online video sharing and social media platform.",
        access: "Public",
    });

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/youtube-url-overview\`.

Call the \`read\` tool again with that path to see the document\u2019s content.
`);

    expect(await cli.run("alpine read /document/youtube-url-overview")).toEqual(`\
# YouTube URL overview

YouTube is an American online video sharing and social media platform.
`);
});

test("read document from a URL with the Alpine domain", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "YouTube URL overview",
        body: "YouTube is an American online video sharing and social media platform.",
        access: "Public",
    });

    expect(await cli.run(`alpine read 'https://alpine.inc/doc/${document.id}'`)).toEqual(`\
Found path for URL: \`/document/youtube-url-overview\`.

Call the \`read\` tool again with that path to see the document\u2019s content.
`);

    expect(await cli.run("alpine read /document/youtube-url-overview")).toEqual(`\
# YouTube URL overview

YouTube is an American online video sharing and social media platform.
`);
});

test("create and read document with a GFM table", async () => {
    expect(
        await cli.run(`\
printf '%s' '# YouTube milestones

| Year | Event |
| - | - |
| 2005 | Founded |
| 2006 | Acquired |' | alpine create document -
`),
    ).toEqual(`\
Create was successful. New document: [YouTube milestones](/document/youtube-milestones).
`);

    expect(await cli.run("alpine read /document/youtube-milestones")).toEqual(`\
# YouTube milestones

| Year | Event |
| - | - |
| 2005 | Founded |
| 2006 | Acquired |
`);
});

test("search for and read document created by a test helper", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "Me at the zoo",
        body: "The first video, “Me at the zoo,” was uploaded on April 23, 2005.",
        access: "Public",
    });

    // Don't wait for the document indexing throttle.
    await indexDocumentSearchEntityImmediately(document);

    expect(await cli.run("alpine search 'Me zoo'")).toEqual(`\
1. [**Me** at the **zoo**](/document/me-at-the-zoo)

   The first video, “**Me** at the **zoo**,” was uploaded on April 23, 2005.
`);

    expect(await cli.run("alpine read /document/me-at-the-zoo")).toEqual(`\
# Me at the zoo

The first video, “Me at the zoo,” was uploaded on April 23, 2005.
`);
});

test("scroll document", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube acquisition](/document/youtube-acquisition).
`);

    expect(await cli.run("alpine read /document/youtube-acquisition")).toEqual(`\
# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.
`);

    expect(await cli.run("alpine scroll /document/youtube-acquisition --offset 2")).toEqual(`\
Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.

(End of file. Showing lines 3-5 of 5.)
`);
});

test("scroll document with offset positioned before path", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube acquisition](/document/youtube-acquisition).
`);

    expect(await cli.run("alpine read /document/youtube-acquisition")).toEqual(`\
# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.
`);

    expect(await cli.run("alpine scroll --offset ' 2 ' /document/youtube-acquisition")).toEqual(`\
Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.

(End of file. Showing lines 3-5 of 5.)
`);
});

test("find in document", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube founders

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube founders](/document/youtube-founders).
`);

    expect(await cli.run("alpine read /document/youtube-founders")).toEqual(`\
# YouTube founders

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim.
`);

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
    expect(
        await cli.run(`\
alpine create document '# YouTube advertising revenue

YouTube’s annual advertising revenue increased to $28.8 billion in 2021.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube advertising revenue](/document/youtube-advertising-revenue).
`);

    expect(await cli.run("alpine read /document/youtube-advertising-revenue")).toEqual(`\
# YouTube advertising revenue

YouTube’s annual advertising revenue increased to $28.8 billion in 2021.
`);

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

test("update document title", async () => {
    expect(
        await cli.run(`\
alpine create document '# Original YouTube title

The document body stays the same.'
`),
    ).toEqual(`\
Create was successful. New document: [Original YouTube title](/document/original-youtube-title).
`);

    expect(await cli.run("alpine read /document/original-youtube-title")).toEqual(`\
# Original YouTube title

The document body stays the same.
`);

    expect(
        await cli.run(
            "alpine update /document/original-youtube-title --old '# Original YouTube title' --new '# Updated YouTube title'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /document/original-youtube-title")).toEqual(`\
# Updated YouTube title

The document body stays the same.
`);
});

test("update document multiple times", async () => {
    expect(
        await cli.run(`\
alpine create document '# Multiple YouTube updates

YouTube has an old title and an old description.'
`),
    ).toEqual(`\
Create was successful. New document: [Multiple YouTube updates](/document/multiple-youtube-updates).
`);

    expect(
        await cli.run(
            "alpine update /document/multiple-youtube-updates --old 'old title' --new 'updated title' --old 'old description' --new 'updated description'",
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/multiple-youtube-updates")).toEqual(`\
# Multiple YouTube updates

YouTube has an updated title and an updated description.
`);
});

test("update document with multiple nominal arguments in unusual orders", async () => {
    expect(
        await cli.run(`\
alpine create document '# Unusually ordered YouTube updates

YouTube repeats one one and two two.'
`),
    ).toEqual(`\
Create was successful. New document: [Unusually ordered YouTube updates](/document/unusually-ordered-youtube-updates).
`);

    expect(
        await cli.run(
            "alpine update --replace-all --new=ONE --old one --old=two --new TWO /document/unusually-ordered-youtube-updates",
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/unusually-ordered-youtube-updates")).toEqual(`\
# Unusually ordered YouTube updates

YouTube repeats ONE ONE and TWO TWO.
`);
});

test("update document with camelCase nominal arg name in unusual orders", async () => {
    expect(
        await cli.run(`\
alpine create document '# Unusually ordered YouTube updates

YouTube repeats one one and two two.'
`),
    ).toEqual(`\
Create was successful. New document: [Unusually ordered YouTube updates](/document/unusually-ordered-youtube-updates).
`);

    expect(
        await cli.run(
            "alpine update --replaceAll --new=ONE --old one --old=two --new TWO /document/unusually-ordered-youtube-updates",
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/unusually-ordered-youtube-updates")).toEqual(`\
# Unusually ordered YouTube updates

YouTube repeats ONE ONE and TWO TWO.
`);
});

test("update document from stdin array", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube stdin update

YouTube repeats one one and then two.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube stdin update](/document/youtube-stdin-update).
`);

    expect(
        await cli.run(
            `printf '%s' '[{"old":"one","new":"ONE","replace-all":true},{"old":"two","new":"TWO"}]' | alpine update /document/youtube-stdin-update --old - --old - --new - --new -`,
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/youtube-stdin-update")).toEqual(`\
# YouTube stdin update

YouTube repeats ONE ONE and then TWO.
`);
});

test("update document from stdin object", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube stdin update

YouTube repeats one one and then two.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube stdin update](/document/youtube-stdin-update).
`);

    expect(
        await cli.run(
            `printf '%s' '{"old":"two","new":"TWO"}' | alpine update /document/youtube-stdin-update --old - --new -`,
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/youtube-stdin-update")).toEqual(`\
# YouTube stdin update

YouTube repeats one one and then TWO.
`);
});

test("update document from stdin object with camelCase arg", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube stdin update

YouTube repeats one one and then two.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube stdin update](/document/youtube-stdin-update).
`);

    expect(
        await cli.run(
            `printf '%s' '{"old":"one","new":"ONE","replaceAll":true}' | alpine update /document/youtube-stdin-update --old - --new -`,
        ),
    ).toEqual("Update was successful.\n");

    expect(await cli.run("alpine read /document/youtube-stdin-update")).toEqual(`\
# YouTube stdin update

YouTube repeats ONE ONE and then two.
`);
});

test("update document from stdin object with CLI arg", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube stdin update

YouTube repeats one one and then two.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube stdin update](/document/youtube-stdin-update).
`);

    expect(
        await cli.run(
            `printf '%s' '{"old":"one","new":"ONE"}' | alpine update /document/youtube-stdin-update --old - --new - --replace-all`,
        ),
    ).toEqual(`\
Error: Couldn’t run command. If the \`--old\` and \`--new\` args are \`-\` that means updates will be read from stdin. Other args like \`--replace-all\` aren’t allowed when reading updates from stdin. Try again but without the \`--replace-all\` arg.
`);

    expect(await cli.run("alpine read /document/youtube-stdin-update")).toEqual(`\
# YouTube stdin update

YouTube repeats one one and then two.
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
        syntax: "alpine read <path> [--limit 20kb]",
    },
    {
        command: "alpine update",
        argName: "path",
        syntax: 'alpine update <path> --old "..." --new "..."',
    },
    {
        command: "alpine scroll",
        argName: "path",
        syntax: "alpine scroll <path> --offset 0 [--limit 20kb]",
    },
    {
        command: "alpine find",
        argName: "path",
        syntax: "alpine find <path> <pattern> [--offset 0] [--limit 5] [--match-limit 4kb]",
    },
    {
        command: "alpine find /document/example",
        argName: "pattern",
        syntax: "alpine find <path> <pattern> [--offset 0] [--limit 5] [--match-limit 4kb]",
    },
    {
        command: "alpine search",
        argName: "query",
        syntax: "alpine search <query> [--limit 10]",
    },
])("rejects a missing required $argName argument", async ({command, argName, syntax}) => {
    expect(await cli.run(command)).toEqual(
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
    expect(await cli.run(command)).toEqual(
        `Error: Couldn\u2019t run command. Unexpected args. Try again but remove the ${countMessage}. Expected syntax: \`alpine search <query> [--limit 10]\`.\n`,
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
    expect(await cli.run(command)).toEqual(
        "Error: Couldn\u2019t run command. There\u2019s more than one `--limit` args. Try again with only one `--limit` arg. Expected syntax: `alpine read <path> [--limit 20kb]`.\n",
    );
});

test("rejects a missing required nominal argument", async () => {
    expect(await cli.run("alpine scroll /document/example")).toEqual(
        "Error: Couldn\u2019t run command. Missing required `--offset` arg. Try again but add the `--offset` arg. Expected syntax: `alpine scroll <path> --offset 0 [--limit 20kb]`.\n",
    );
});

test("rejects an unknown nominal argument", async () => {
    expect(await cli.run("alpine read /document/example --unknown=value")).toEqual(
        "Error: Couldn\u2019t run command. Unrecognized `--unknown` arg. Try again without the `--unknown` arg. Expected syntax: `alpine read <path> [--limit 20kb]`.\n",
    );
});

test("rejects an update without an old argument", async () => {
    expect(await cli.run("alpine update /document/example")).toEqual(
        'Error: Couldn\u2019t run command. Missing required `--old` arg. Try again but add the `--old` arg. Expected syntax: `alpine update <path> --old "..." --new "..."`.\n',
    );
});

test("rejects an update without a new argument", async () => {
    expect(await cli.run("alpine update /document/example --old=before")).toEqual(
        'Error: Couldn\u2019t run command. Missing required `--new` arg. Try again but add the `--new` arg. Expected syntax: `alpine update <path> --old "..." --new "..."`.\n',
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
    expect(await cli.run(command)).toEqual(
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
    expect(await cli.run(command)).toEqual(
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
    expect(await cli.run(command)).toEqual(
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
    expect(
        await cli.run(`printf '%s' '${stdin}' | alpine update /document/example --old - --new -`),
    ).toEqual(
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
        name: "a non-integer find result limit",
        command: "alpine find /document/example pattern --limit=nope",
        argName: "limit",
        value: "nope",
    },
])("rejects $name", async ({command, argName, value}) => {
    expect(await cli.run(command)).toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t parse non-negative integer from: ${value.length === 0 ? "empty" : `\`${value}\``}. Try again with zero or a positive integer for the \`--${argName}\` arg.\n`,
    );
});

test.each([
    {
        command: "alpine unknown",
        subcommand: "unknown",
    },
])("rejects subcommand `$subcommand`", async ({command, subcommand}) => {
    expect(await cli.run(command)).toEqual(
        `Error: Couldn\u2019t run command. Unknown subcommand: \`${subcommand}\`. Try again with one of \`read\`, \`update\`, \`create\`, or \`search\`.\n`,
    );
});

test("rejects a data path whose directory cannot be created", async () => {
    expect(
        await cli.run("ALPINE_DATA_PATH=/dev/null/alpine-cli-test alpine read /document/example"),
    ).toEqual(
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

    expect(
        await cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
${writeAuthCommand}
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t read \`auth.json\` from \`${dataDirectoryPath}\`.\n`,
    );
});

test("rejects an auth file without an API key", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-missing-api-key`;

    expect(
        await cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
printf '%s' '{}' > "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).toEqual(
        "Error: Couldn\u2019t run command. Couldn\u2019t find an `apiKey` property in `auth.json`.\n",
    );
});

test("rejects a data path whose database cannot be opened", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-invalid-database`;

    expect(
        await cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
cp "$ALPINE_DATA_PATH/auth.json" "$data_path/auth.json"
mkdir "$data_path/agents-web.db"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t open the database in \`${dataDirectoryPath}\`. Maybe you can\u2019t write to \`${dataDirectoryPath}\`? Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.\n`,
    );
});

test("rejects an unreachable auth API", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-unreachable-auth-api`;

    expect(
        await cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
sed -E 's/,"authResponse":.*$/}/' "$ALPINE_DATA_PATH/auth.json" > "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" ALPINE_API_URL=http://127.0.0.1:1 alpine read /document/example`),
    ).toEqual(
        "Error: Couldn\u2019t run command. Couldn\u2019t get the current bot from the API. Make sure you\u2019re online, your API key isn\u2019t revoked, and you can reach `http://127.0.0.1:1/auth`.\n",
    );
});

test("rejects an auth file that cannot be updated", async () => {
    const dataDirectoryPath = `${cli.dataDirectoryPath}-readonly-auth-file`;

    expect(
        await cli.run(`data_path="${dataDirectoryPath}"
mkdir "$data_path"
sed -E 's/,"authResponse":.*$/}/' "$ALPINE_DATA_PATH/auth.json" > "$data_path/auth.json"
chmod 400 "$data_path/auth.json"
ALPINE_DATA_PATH="$data_path" alpine read /document/example`),
    ).toEqual(
        `Error: Couldn\u2019t run command. Couldn\u2019t write \`auth.json\` to \`${dataDirectoryPath}\`. Try again after confirming the user running this CLI is allowed to write to \`${dataDirectoryPath}\`.\n`,
    );
});

// TODO(#agents-web): Implement the document comment thread creation API endpoint.
test("rejects creating a document comment thread while the API endpoint is unimplemented", async () => {
    expect(
        await cli.run(`\
alpine create document '# YouTube launch review

The launch date needs verification.'
`),
    ).toEqual(`\
Create was successful. New document: [YouTube launch review](/document/youtube-launch-review).
`);

    expect(await cli.run("alpine read /document/youtube-launch-review")).toEqual(`\
# YouTube launch review

The launch date needs verification.
`);

    expect(
        await cli.run(`\
alpine create document-comment-thread 'Document comment thread on [YouTube launch review](/document/youtube-launch-review).

- [ ] Unresolved

<blockquote>

launch date

</blockquote>

<comment>

Can we verify this date?

</comment>

End of comments.'
`),
    ).toEqual(`\
Error: Couldn’t create document comment thread. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Document comment thread creation API endpoint hasn’t been implemented yet
`);
});

test("read a document with a comment thread mark", async () => {
    const title = "YouTube comment mark";
    const body = "Review the launch date.";
    const commentedText = "launch date";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    await document.createCommentThread(
        cli.session,
        {from: commentStart, to: commentStart + commentedText.length},
        "Can we verify this date?",
    );

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/youtube-comment-mark\`.

Call the \`read\` tool again with that path to see the document’s content.
`);

    expect(await cli.run("alpine read /document/youtube-comment-mark")).toEqual(`\
# YouTube comment mark

Review the <comment id="1">launch date</comment>.
`);
});

test("search for and read a comment at the start of an unresolved document comment thread", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "Resolved YouTube moderation";
    const body = "The moderation decision was documented here.";
    const commentedText = "moderation decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Solenodon first comment.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 17; index++) {
        await commentThread.createComment(
            aliceSession,
            `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** first comment.](/document-comment/alice-solenodon-first-comment)
`);

    expect(await cli.run("alpine read /document-comment/alice-solenodon-first-comment --limit=1kb"))
        .toEqual(`\
Document comment thread on [Resolved YouTube moderation](/document/resolved-youtube-moderation). [Next page »](/document/resolved-youtube-moderation/comments/1?after=2)

- [ ] Unresolved

<blockquote>

moderation decision

</blockquote>

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
`);
});

test("search for and read a comment at the end of an unresolved document comment thread", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "Resolved YouTube moderation";
    const body = "The moderation decision was documented here.";
    const commentedText = "moderation decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Paginated comment 0. This comment has enough detail to make the response require pagination.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 17; index++) {
        await commentThread.createComment(
            aliceSession,
            index === 16
                ? "Solenodon final comment."
                : `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** final comment.](/document-comment/alice-solenodon-final-comment)
`);

    expect(await cli.run("alpine read /document-comment/alice-solenodon-final-comment --limit=1kb"))
        .toEqual(`\
Document comment thread on [Resolved YouTube moderation](/document/resolved-youtube-moderation). [Previous page »](/document/resolved-youtube-moderation/comments/1?before=13)

<time>May 14th at 12:05pm EDT</time>

<comment id="13" from="[Alice](/human/alice)">

Paginated comment 13. This comment has enough detail to make the response require pagination.

</comment>

<comment id="14" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 14. This comment has enough detail to make the response require pagination.

</comment>

<comment id="15" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 15. This comment has enough detail to make the response require pagination.

</comment>

<comment id="16" from="[Alice](/human/alice)" time="5 minutes later">

Solenodon final comment.

</comment>

End of comments.
`);
});

test("search for and read a comment at the start of a resolved document comment thread", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "Resolved YouTube moderation";
    const body = "The moderation decision was documented here.";
    const commentedText = "moderation decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Solenodon first comment.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 17; index++) {
        await commentThread.createComment(
            aliceSession,
            `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await commentThread.resolve(aliceSession);

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** first comment.](/document-comment/alice-solenodon-first-comment)
`);

    expect(await cli.run("alpine read /document-comment/alice-solenodon-first-comment --limit=1kb"))
        .toEqual(`\
Document comment thread on [Resolved YouTube moderation](/document/resolved-youtube-moderation). [Next page »](/document/resolved-youtube-moderation/comments/1?after=2)

- [x] Resolved

<blockquote>

moderation decision

</blockquote>

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
`);

    expect(
        await cli.run(
            "alpine read /document/resolved-youtube-moderation/comments/1?after=2 --limit=1kb",
        ),
    ).toEqual(`\
Document comment thread on [Resolved YouTube moderation](/document/resolved-youtube-moderation). [Next page »](/document/resolved-youtube-moderation/comments/1?after=6)

<time>May 14th at 11:15am EDT</time>

<comment id="3" from="[Alice](/human/alice)">

Paginated comment 3. This comment has enough detail to make the response require pagination.

</comment>

<comment id="4" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 4. This comment has enough detail to make the response require pagination.

</comment>

<comment id="5" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 5. This comment has enough detail to make the response require pagination.

</comment>

<comment id="6" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 6. This comment has enough detail to make the response require pagination.

</comment>
`);
});

test("search for and read a comment at the end of a resolved document comment thread", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "Resolved YouTube moderation";
    const body = "The moderation decision was documented here.";
    const commentedText = "moderation decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Paginated comment 0. This comment has enough detail to make the response require pagination.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 17; index++) {
        await commentThread.createComment(
            aliceSession,
            index === 16
                ? "Solenodon final comment."
                : `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }
    await commentThread.resolve(aliceSession);

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [Alice: **Solenodon** final comment.](/document-comment/alice-solenodon-final-comment)
`);

    expect(await cli.run("alpine read /document-comment/alice-solenodon-final-comment --limit=1kb"))
        .toEqual(`\
Document comment thread on [Resolved YouTube moderation](/document/resolved-youtube-moderation). [Previous page »](/document/resolved-youtube-moderation/comments/1?before=13)

<time>May 14th at 12:05pm EDT</time>

<comment id="13" from="[Alice](/human/alice)">

Paginated comment 13. This comment has enough detail to make the response require pagination.

</comment>

<comment id="14" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 14. This comment has enough detail to make the response require pagination.

</comment>

<comment id="15" from="[Alice](/human/alice)" time="5 minutes later">

Paginated comment 15. This comment has enough detail to make the response require pagination.

</comment>

<comment id="16" from="[Alice](/human/alice)" time="5 minutes later">

Solenodon final comment.

</comment>

End of comments.
`);
});

test("read fallback content after removing an unresolved document comment mark", async () => {
    const dianaSession = await cli.session.space.createSession({name: "Diana"});

    const title = "Removed YouTube comment preview";
    const body = "The retired playback note should stay xylophonic and visible.";
    const commentedText = "retired playback note";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);

    const commentThread = await document.createCommentThread(
        dianaSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Why was this playback note removed?",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );
    await commentThread.createComment(dianaSession, "The west coast review is complete.", {
        parent: commentThread.firstComment,
        createdTimeZone: assertTimeZone("America/Los_Angeles"),
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    // Don't wait for the document indexing throttle.
    await indexDocumentSearchEntityImmediately(document);

    expect(await cli.run("alpine search xylophonic")).toEqual(`\
1. [Removed YouTube comment preview](/document/removed-youtube-comment-preview)

   The retired playback note should stay **xylophonic** and visible.
`);

    expect(await cli.run("alpine read /document/removed-youtube-comment-preview")).toEqual(`\
# Removed YouTube comment preview

The <comment id="1">retired playback note</comment> should stay xylophonic and visible.
`);

    expect(
        await cli.run(
            `alpine update /document/removed-youtube-comment-preview --old '<comment id="1">retired playback note</comment>' --new 'retired playback note'`,
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /document/removed-youtube-comment-preview/comments/1"))
        .toEqual(`\
Document comment thread on [Removed YouTube comment preview](/document/removed-youtube-comment-preview).

- [ ] Unresolved

<blockquote match="deleted">

retired playback note

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Diana](/human/diana)">

Why was this playback note removed?

</comment>

<comment id="1" from="[Diana](/human/diana)" time="5 minutes later" timezone="PDT">

<blockquote cite="?comment=0">

[Diana](/human/diana): Why was this playback note removed?

</blockquote>

The west coast review is complete.

</comment>

End of comments.
`);
});

test("resolve a document comment thread", async () => {
    const title = "YouTube resolution review";
    const body = "Review the launch decision.";
    const commentedText = "launch decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        cli.session,
        {from: commentStart, to: commentStart + commentedText.length},
        "Please resolve this review.",
    );

    await indexDocumentSearchEntityImmediately(document);
    expect(await cli.run("alpine search 'YouTube resolution review'")).toEqual(
        expect.stringContaining(
            "[**YouTube resolution review**](/document/youtube-resolution-review)",
        ),
    );
    expect(await cli.run("alpine read /document/youtube-resolution-review")).toEqual(`\
# YouTube resolution review

Review the <comment id="1">launch decision</comment>.
`);
    expect(await cli.run("alpine read /document/youtube-resolution-review/comments/1")).toEqual(
        expect.stringContaining("- [ ] Unresolved"),
    );
    expect(
        await cli.run(
            "alpine update /document/youtube-resolution-review/comments/1 --old '- [ ] Unresolved' --new '- [x] Resolved'",
        ),
    ).toEqual("Update was successful.\n");

    expect(await commentThread.get()).toEqual(expect.objectContaining({isResolved: true}));
    expect(await cli.run("alpine read /document/youtube-resolution-review")).toEqual(`\
# YouTube resolution review

Review the launch decision.
`);
    expect(await cli.run("alpine read /document/youtube-resolution-review/comments/1")).toEqual(
        expect.stringContaining("- [x] Resolved"),
    );
});

test("unresolve a document comment thread", async () => {
    const title = "YouTube reopened review";
    const body = "Revisit the launch decision.";
    const commentedText = "launch decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        cli.session,
        {from: commentStart, to: commentStart + commentedText.length},
        "Please reopen this review.",
    );

    await indexDocumentSearchEntityImmediately(document);
    expect(await cli.run("alpine search 'YouTube reopened review'")).toEqual(
        expect.stringContaining("[**YouTube reopened review**](/document/youtube-reopened-review)"),
    );
    expect(await cli.run("alpine read /document/youtube-reopened-review")).toEqual(`\
# YouTube reopened review

Revisit the <comment id="1">launch decision</comment>.
`);
    expect(await cli.run("alpine read /document/youtube-reopened-review/comments/1")).toEqual(
        expect.stringContaining("- [ ] Unresolved"),
    );
    await commentThread.resolve(cli.session);
    expect(await cli.run("alpine read /document/youtube-reopened-review/comments/1")).toEqual(
        expect.stringContaining("- [x] Resolved"),
    );
    expect(
        await cli.run(
            "alpine update /document/youtube-reopened-review/comments/1 --old '- [x] Resolved' --new '- [ ] Unresolved'",
        ),
    ).toEqual("Update was successful.\n");

    expect(await commentThread.get()).toEqual(expect.objectContaining({isResolved: false}));
    expect(await cli.run("alpine read /document/youtube-reopened-review")).toEqual(`\
# YouTube reopened review

Revisit the <comment id="1">launch decision</comment>.
`);
    expect(await cli.run("alpine read /document/youtube-reopened-review/comments/1")).toEqual(
        expect.stringContaining("- [ ] Unresolved"),
    );
});

test("add a document comment", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "YouTube evidence review";
    const body = "Review the launch evidence.";
    const commentedText = "launch evidence";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Please review this evidence.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    await indexDocumentSearchEntityImmediately(document);
    expect(await cli.run("alpine search 'YouTube evidence review'")).toEqual(
        expect.stringContaining("[**YouTube evidence review**](/document/youtube-evidence-review)"),
    );
    expect(await cli.run("alpine read /document/youtube-evidence-review")).toEqual(`\
# YouTube evidence review

Review the <comment id="1">launch evidence</comment>.
`);

    expect(await cli.run("alpine read /document/youtube-evidence-review/comments/1")).toEqual(`\
Document comment thread on [YouTube evidence review](/document/youtube-evidence-review).

- [ ] Unresolved

<blockquote>

launch evidence

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

Please review this evidence.

</comment>

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /document/youtube-evidence-review/comments/1 --old 'End of comments.' --new '<comment timezone="UTC">

I reviewed the launch evidence.

</comment>

End of comments.'
`),
    ).toEqual("Update was successful.\n");

    const newComment = await commentThread._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");

    expect(newComment.payload.content.doc.textContent).toEqual("I reviewed the launch evidence.");
});

test("add a document comment with a file attachment", async () => {
    // TODO: Remove the source document once agents can upload files through the API.
    // Until then, it gives the agent a path it can use to reference the file.
    const sourceDocument = await TestDocument.create(cli.session, {
        title: "Attachment source",
        body: "Attachment available below.",
        access: "Public",
    });
    const file = await TestFile.create(cli.session);
    await sourceDocument.attachFile(cli.session, file);

    const targetTitle = "YouTube evidence review";
    const targetBody = "Review the attached launch evidence.";
    const commentedText = "launch evidence";
    const targetDocument = await TestDocument.create(cli.session, {
        title: targetTitle,
        body: targetBody,
        access: "Public",
    });
    const commentStart = targetTitle.length + 3 + targetBody.indexOf(commentedText);
    const commentThread = await targetDocument.createCommentThread(
        cli.session,
        {from: commentStart, to: commentStart + commentedText.length},
        "Please attach the source image.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    await indexDocumentSearchEntityImmediately(sourceDocument);
    await indexDocumentSearchEntityImmediately(targetDocument);

    // Reading the source gives the CLI a stable pathname for the file that can be
    // reused in the document comment update.
    expect(await cli.run("alpine search 'Attachment source'")).toEqual(
        expect.stringContaining("[**Attachment source**](/document/attachment-source)"),
    );
    expect(await cli.run("alpine search 'YouTube evidence review'")).toEqual(
        expect.stringContaining("[**YouTube evidence review**](/document/youtube-evidence-review)"),
    );
    expect(await cli.run("alpine read /document/attachment-source")).toEqual(`\
# Attachment source

Attachment available below.

![](/file/image.png)
`);
    expect(await cli.run("alpine read /document/youtube-evidence-review")).toEqual(`\
# YouTube evidence review

Review the attached <comment id="1">launch evidence</comment>.
`);
    expect(await cli.run("alpine read /document/youtube-evidence-review/comments/1")).toEqual(`\
Document comment thread on [YouTube evidence review](/document/youtube-evidence-review).

- [ ] Unresolved

<blockquote>

launch evidence

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Anthony](/human/anthony-mose)">

Please attach the source image.

</comment>

End of comments.
`);

    expect(
        await cli.run(`\
alpine update /document/youtube-evidence-review/comments/1 --old 'End of comments.' --new '<comment>

Attached launch evidence.

![](/file/image.png)

</comment>

End of comments.'
`),
    ).toEqual("Update was successful.\n");

    expect(
        (await cli.run("alpine read /document/youtube-evidence-review/comments/1")).replace(
            /<time>([^<]+)<\/time>/g,
            (timeElement, label: string) =>
                label === "May 14th at 11:00am EDT" ? timeElement : "<time><created-time></time>",
        ),
    ).toEqual(`\
Document comment thread on [YouTube evidence review](/document/youtube-evidence-review).

- [ ] Unresolved

<blockquote>

launch evidence

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Anthony](/human/anthony-mose)">

Please attach the source image.

</comment>

<time><created-time></time>

<comment id="1" from="[My](/bot/my-bot)">

Attached launch evidence.

![](/file/image.png)

</comment>

End of comments.
`);

    const newComment = await commentThread._getMessage(cli.session.action(), 1);
    assert(newComment.payload.type === "Content");
    expect(
        newComment.payload.files.map(commentFile =>
            commentFile.type === "File"
                ? {type: commentFile.type, id: commentFile.file.id}
                : commentFile,
        ),
    ).toEqual([{type: "File", id: file.id}]);
});

test("search for a document and read one of its comment threads", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});

    const title = "YouTube moderation";
    const body = "The moderation decision was documented here. Solenodon.";
    const commentedText = "moderation decision";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "First comment.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 17; index++) {
        await commentThread.createComment(
            aliceSession,
            `Paginated comment ${index}. This comment has enough detail to make the response require pagination.`,
            {overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5))},
        );
    }

    await indexDocumentSearchEntityImmediately(document);

    expect(await cli.run("alpine search solenodon")).toEqual(`\
1. [YouTube moderation](/document/youtube-moderation)

   **Solenodon**.
`);

    expect(await cli.run("alpine read /document/youtube-moderation")).toEqual(`\
# YouTube moderation

The <comment id="1">moderation decision</comment> was documented here. Solenodon.
`);

    expect(await cli.run("alpine read /document/youtube-moderation/comments/1 --limit=1kb"))
        .toEqual(`\
Document comment thread on [YouTube moderation](/document/youtube-moderation). [Next page »](/document/youtube-moderation/comments/1?after=3)

- [ ] Unresolved

<blockquote>

moderation decision

</blockquote>

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

First comment.

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
        await cli.run("alpine read '/document/youtube-moderation/comments/1?after=3' --limit=1kb"),
    ).toEqual(`\
Document comment thread on [YouTube moderation](/document/youtube-moderation). [Next page »](/document/youtube-moderation/comments/1?after=7)

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

test("read document comments around the blockquote cursor", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const title = "YouTube comment cursor";
    const body = "Review the cursor boundaries.";
    const commentedText = "cursor boundaries";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "First boundary comment.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );
    await commentThread.createComment(aliceSession, "Second boundary comment.", {
        overrideCreatedTime: new Date("2026-05-14T15:05:00.000Z"),
    });

    await indexDocumentSearchEntityImmediately(document);
    expect(await cli.run("alpine search 'YouTube comment cursor'")).toEqual(
        expect.stringContaining("(/document/youtube-comment-cursor)"),
    );
    expect(await cli.run("alpine read /document/youtube-comment-cursor")).toEqual(`\
# YouTube comment cursor

Review the <comment id="1">cursor boundaries</comment>.
`);

    expect(
        await cli.run("alpine read '/document/youtube-comment-cursor/comments/1?after=blockquote'"),
    ).toEqual(`\
Document comment thread on [YouTube comment cursor](/document/youtube-comment-cursor).

<time>May 14th at 11:00am EDT</time>

<comment id="0" from="[Alice](/human/alice)">

First boundary comment.

</comment>

<comment id="1" from="[Alice](/human/alice)" time="5 minutes later">

Second boundary comment.

</comment>

End of comments.
`);

    expect(
        await cli.run(
            "alpine read '/document/youtube-comment-cursor/comments/1?before=blockquote'",
        ),
    ).toEqual(`\
Document comment thread on [YouTube comment cursor](/document/youtube-comment-cursor).
`);
});

test("read a bounded range of document comments from the end", async () => {
    const aliceSession = await cli.session.space.createSession({name: "Alice"});
    const title = "YouTube bounded comments";
    const body = "Review the bounded comment range.";
    const commentedText = "bounded comment range";
    const document = await TestDocument.create(cli.session, {
        title,
        body,
        access: "Public",
    });
    const commentStart = title.length + 3 + body.indexOf(commentedText);
    const commentThread = await document.createCommentThread(
        aliceSession,
        {from: commentStart, to: commentStart + commentedText.length},
        "Bounded comment 0.",
        {overrideCreatedTime: new Date("2026-05-14T15:00:00.000Z")},
    );

    for (let index = 1; index < 3; index++) {
        await commentThread.createComment(aliceSession, `Bounded comment ${index}.`, {
            overrideCreatedTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5)),
        });
    }

    await indexDocumentSearchEntityImmediately(document);
    expect(await cli.run("alpine search 'YouTube bounded comments'")).toEqual(
        expect.stringContaining("(/document/youtube-bounded-comments)"),
    );
    expect(await cli.run("alpine read /document/youtube-bounded-comments")).toEqual(`\
# YouTube bounded comments

Review the <comment id="1">bounded comment range</comment>.
`);

    expect(
        await cli.run(
            "alpine read '/document/youtube-bounded-comments/comments/1?from=end&after=0&before=2'",
        ),
    ).toEqual(`\
Document comment thread on [YouTube bounded comments](/document/youtube-bounded-comments).

<time>May 14th at 11:05am EDT</time>

<comment id="1" from="[Alice](/human/alice)">

Bounded comment 1.

</comment>
`);
});
