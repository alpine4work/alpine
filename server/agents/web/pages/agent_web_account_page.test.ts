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
        {
            name: "missing name display message",
            pageLink: accountId,
            markdown: `\
Alice Smith

- Role: Member
`,
            parseError:
                "Expected a name at the start of the page. Try again with a markdown h1 first (e.g. `# John Doe`).",
        },
        {
            name: "unexpected markdown display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

Unexpected paragraph.
`,
            parseError:
                "Unexpected markdown on line 3. Try again with only fields in an unordered list (e.g. `- Role: Member`).",
        },
        {
            name: "unknown field display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- Team: Engineering
`,
            parseError:
                "Unexpected field \u201CTeam\u201D on line 3. Try again with \u201CState\u201D, \u201CRole\u201D, or \u201CShort name\u201D.",
        },
        {
            name: "duplicate field display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- Role: Member
- Role: Admin
`,
            parseError:
                "Field \u201CRole\u201D appears more than once on line 4. Try again with each field only present once in the field list.",
        },
        {
            name: "nested field markdown display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- Role: Member
  - Nested
`,
            parseError:
                "Unexpected markdown after field \u201CRole\u201D on line 4. Try again with one unordered list item per field where the field name is followed by the field value with a colon in between (e.g. `- Role: Member`).",
        },
        {
            name: "missing role display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- State: Removed
`,
            parseError:
                "Expected a \u201CRole\u201D field. Try again with a role like `- Role: Member`.",
        },
        {
            name: "malformed field display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- **Role:** Member
`,
            parseError:
                "Unexpected markdown on line 3. Try again with one unordered list item per field where the field name is followed by the field value with a colon in between (e.g. `- Role: Member`).",
        },
        {
            name: "unexpected state display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- State: Active
- Role: Member
`,
            parseError:
                "Unexpected state \u201CActive\u201D on line 3. Try again with \u201CRemoved from space\u201D or \u201CInvited, but hasn\u2019t accepted their invite\u201D.",
        },
        {
            name: "unexpected role display message",
            pageLink: accountId,
            markdown: `\
# Alice Smith

- Role: Boss
`,
            parseError:
                "Unexpected role \u201CBoss\u201D on line 3. Try again with \u201COwner\u201D, \u201CAdmin\u201D, or \u201CMember\u201D.",
        },
    ],
});
