/* eslint-disable cyberworlds/string-quotes -- CLI fixtures require shell quotes. */

import {setupCliIntegrationTests} from "~/server/agents/cli/integration_tests/setup_cli_integration_tests.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";

const cli = setupCliIntegrationTests();

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

    expect([
        await cli.run("alpine search 'Me zoo'"),
        await cli.run("alpine read /document/me-at-the-zoo"),
    ]).toEqual([
        `\
1. [Me at the zoo](/document/me-at-the-zoo)

   The first video, “**Me** at the **zoo**,” was uploaded on April 23, 2005.
`,
        `\
# Me at the zoo

The first video, “Me at the zoo,” was uploaded on April 23, 2005.
`,
    ]);
});

test("scroll document", async () => {
    await cli.run(`\
alpine create document '# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.'
`);

    await cli.run("alpine read /document/youtube-acquisition");

    expect(await cli.run("alpine scroll /document/youtube-acquisition 0")).toEqual(`\
# YouTube acquisition

Google bought YouTube for $1.65 billion in October 2006.

The acquisition expanded the platform beyond advertising.

(End of file. Showing lines 1-5 of 5.)
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

    expect([
        await cli.run("alpine update /document/youtube-advertising-revenue '2021' '2022'"),
        await cli.run("alpine read /document/youtube-advertising-revenue"),
    ]).toEqual([
        `\
Update was successful.
`,
        `\
# YouTube advertising revenue

YouTube’s annual advertising revenue increased to $28.8 billion in 2022.
`,
    ]);
});
