import {
    AgentWebAccountPage,
    normalizeAgentWebAccountPage,
    parseAgentWebAccountPage,
    printAgentWebAccountPage,
} from "~/server/agents/web/pages/agent_web_account_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const accountId = generateId<AccountId>();

runAgentWebPageTests<AccountId, AgentWebAccountPage>({
    print: printAgentWebAccountPage,
    parse: parseAgentWebAccountPage,
    normalize: normalizeAgentWebAccountPage,
    tests: [
        {
            name: "active account page",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- Role: Member
`,
            page: {
                type: "Account",
                name: "Alice Smith",
                state: null,
                role: "Member",
                shortName: "Alice Smith",
            },
        },
        {
            name: "removed account page with short name",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- State: Removed from space
- Role: Admin
- Short name: Alice
`,
            page: {
                type: "Account",
                name: "Alice Smith",
                state: {type: "Removed"},
                role: "Admin",
                shortName: "Alice",
            },
        },
        {
            name: "invited account page accepts fields in any order",
            pageLink: accountId,
            markdown: `\
# Bob Jones

- Short name: Bob
- Role: Owner
- State: Invited
`,
            printMarkdown: `\
# Bob Jones

- State: Invited, but hasn\u2019t accepted their invite
- Role: Owner
- Short name: Bob
`,
            page: {
                type: "Account",
                name: "Bob Jones",
                state: {type: "InvitePending"},
                role: "Owner",
                shortName: "Bob",
            },
        },
        {
            name: "removed shorthand state",
            pageLink: accountId,
            markdown: `\
# Charlie Brown

- State: Removed
- Role: Member
`,
            printMarkdown: `\
# Charlie Brown

- State: Removed from space
- Role: Member
`,
            page: {
                type: "Account",
                name: "Charlie Brown",
                state: {type: "Removed"},
                role: "Member",
                shortName: "Charlie Brown",
            },
        },
    ],
});
