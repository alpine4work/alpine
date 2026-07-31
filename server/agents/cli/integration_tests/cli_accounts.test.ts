/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest();

test("read an active admin whose short name matches their name", async () => {
    await cli.space.createSession({name: "Alice", role: "Admin"});

    expect(await cli.run("alpine search Alice")).toEqual(`\
1. [**Alice**](/human/alice)
`);

    expect(await cli.run("alpine read /human/alice")).toEqual(`\
# Alice

- Role: Admin
`);
});

test("read a removed member with a distinct short name and reject updating them", async () => {
    const bobSession = await cli.space.createSession({name: "Bob Jones", role: "Member"});

    expect(await cli.run("alpine search 'Bob Jones'")).toEqual(`\
1. [**Bob Jones**](/human/bob-jones)

2. [My Bot](/bot/my-bot)
`);
    await cli.space.removeAccount(bobSession);

    expect(await cli.run("alpine read /human/bob-jones")).toEqual(`\
# Bob Jones

- State: Removed from space
- Role: Member
- Short name: Bob
`);

    expect(
        await cli.run(
            "alpine update /human/bob-jones --old '- Role: Member' --new '- Role: Admin'",
        ),
    ).toEqual(`\
Error: Couldn’t update \`/human/bob-jones\`. Can’t update humans or bots using the \`update\` tool. Try updating another page instead.
`);
});
