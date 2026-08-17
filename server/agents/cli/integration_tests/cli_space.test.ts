/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest({spaceName: "Product Lab"});

test("read the current space and its active human members", async () => {
    expect(await cli.run("alpine read /space")).toEqual(`\
# Product Lab

## Members

- [Anthony Mose](/human/anthony-mose)
`);
});

test("read active and invited humans but not removed humans or bots", async () => {
    await cli.space.createSession({name: "Alice Smith", role: "Member"});
    const removedSession = await cli.space.createSession({
        name: "Bob Removed",
        role: "Member",
    });
    await cli.space.removeAccount(removedSession);
    await cli.session.inviteEmailAddress("charlie@example.com");

    expect(await cli.run("alpine read /space")).toEqual(`\
# Product Lab

## Members

- [Anthony Mose](/human/anthony-mose)
- [Alice Smith](/human/alice-smith)
- [charlie@example.com](/human/charlie-example-com)
`);
});

test("reject updating the current space", async () => {
    expect(await cli.run("alpine read /space")).toEqual(`\
# Product Lab

## Members

- [Anthony Mose](/human/anthony-mose)
`);

    expect(await cli.run("alpine update /space --old '# Product Lab' --new '# Product Studio'"))
        .toEqual(`\
Error: Couldn’t update \`/space\`. Can’t update spaces using the \`update\` tool for now. Try updating another page instead.
`);
});
