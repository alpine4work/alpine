/* eslint-disable cyberworlds/string-quotes */

import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";

const cli = setupCliForTest();

test("create channel", async () => {
    expect(
        await cli.run(`\
alpine create channel '# YouTube launch updates

Updates from the launch team.'
`),
    ).toEqual(`\
Create was successful. New channel: [YouTube launch updates](/channel/youtube-launch-updates).
`);
});

test("read channel created by the CLI", async () => {
    await cli.run(`\
alpine create channel '# YouTube channel overview

Updates from the launch team.'
`);

    expect(await cli.run("alpine read /channel/youtube-channel-overview")).toEqual(`\
# YouTube channel overview

Updates from the launch team.

---

End of posts.
`);
});

test("create channel from stdin with a divider in the description", async () => {
    await cli.run(`printf '%s' '# YouTube launch notes

Before the divider.

<hr />

After the divider.

---' | alpine create channel -`);

    expect(await cli.run("alpine read /channel/youtube-launch-notes")).toEqual(`\
# YouTube launch notes

Before the divider.

<hr />

After the divider.

---

End of posts.
`);
});

test("update channel name and description", async () => {
    await cli.run(`\
alpine create channel '# YouTube channel rename

Old launch description.'
`);

    await cli.run("alpine read /channel/youtube-channel-rename");

    expect(
        await cli.run(
            "alpine update /channel/youtube-channel-rename --old '# YouTube channel rename' --new '# YouTube product updates' --old 'Old launch description.' --new 'New product update description.'",
        ),
    ).toEqual(`\
Update was successful.
`);

    expect(await cli.run("alpine read /channel/youtube-channel-rename")).toEqual(`\
# YouTube product updates

New product update description.

---

End of posts.
`);
});
