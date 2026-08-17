import {List, ListItem, Node, PhrasingContent, Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.open_source.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.open_source.js";
import {printMarkdownPhrasingContentText} from "~/shared/api/content/print_markdown_phrasing_content_text.open_source.js";
import {
    ApiAccountSpace,
    ApiAccountSpaceInactive,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export type AgentWebAccountPage = {
    readonly type: "Account";
    readonly name: string;
    readonly state: ApiAccountSpaceInactive | null;
    readonly role: ApiAccountSpace["role"];
    readonly shortName: string;
};

export type AgentWebAccountPageMetadata = {
    readonly type: "Account";
    readonly id: AccountId;
};

export type AgentWebAccountPageWithMetadata = AgentWebAccountPage & {
    readonly metadata: AgentWebAccountPageMetadata;
};

type AgentWebAccountFieldName = "state" | "role" | "shortName";

export async function readAgentWebAccountPage(
    context: AgentWebContext,
    id: AccountId,
    {printPage}: {printPage: (page: AgentWebAccountPage) => Promise<string>},
): Promise<{response: string; metadata: AgentWebAccountPageMetadata}> {
    const {
        data: {account},
    } = await context.api.get(context.span, "/spaces/{id}/accounts/{accountId}", {
        params: {path: {id: context.spaceId, accountId: id}},
    });

    const page: AgentWebAccountPageWithMetadata = {
        type: "Account",
        name: account.name,
        state: account.space.inactive ?? null,
        role: account.space.role,
        shortName: account.shortName,
        metadata: {
            type: "Account",
            id,
        },
    };

    return {
        response: await printPage(page),
        metadata: page.metadata,
    };
}

export function updateAgentWebAccountPage(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: AgentWebContextWithoutStorage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPageMetadata: AgentWebAccountPageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPage: AgentWebAccountPage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    newPage: AgentWebAccountPage,
): never {
    throw new InvalidArgumentError("Can\u2019t update accounts", {
        displayMessage: errorDisplayMessage`Can\u2019t update humans or bots using the \`update\` tool. Try updating another page instead.`,
    });
}

export function normalizeAgentWebAccountPage<Page extends AgentWebAccountPage>(page: Page): Page {
    return page;
}

export async function printAgentWebAccountPage(
    storage: AgentWebSessionStorage,
    id: AccountId,
    page: AgentWebAccountPage,
): Promise<Root> {
    const listItems: Array<ListItem> = [];

    if (page.state) {
        listItems.push(
            createAgentWebAccountFieldListItem([
                {
                    type: "text",
                    value: `State: ${printAgentWebAccountState(page.state)}`,
                },
            ]),
        );
    }

    listItems.push(
        createAgentWebAccountFieldListItem([
            {
                type: "text",
                value: `Role: ${page.role}`,
            },
        ]),
    );

    if (page.shortName !== page.name) {
        listItems.push(
            createAgentWebAccountFieldListItem([
                {
                    type: "text",
                    value: `Short name: ${page.shortName}`,
                },
            ]),
        );
    }

    return {
        type: "root",
        children: [
            {
                type: "heading",
                depth: 1,
                children: [{type: "text", value: page.name}],
            },
            {
                type: "list",
                ordered: false,
                spread: false,
                children: listItems,
            },
        ],
    };
}

export async function parseAgentWebAccountPage(
    storage: AgentWebSessionStorage,
    id: AccountId | null,
    root: Root,
): Promise<AgentWebAccountPage> {
    let name: string;
    {
        const firstChild = root.children[0];

        if (firstChild?.type === "heading" && firstChild.depth === 1) {
            name = printMarkdownPhrasingContentText(firstChild.children);
        } else {
            throw new InvalidArgumentError("Missing name in account", {
                displayMessage: errorDisplayMessage`Expected a name at the start of the page. Try again with a markdown h1 first (e.g. \`# John Doe\`).`,
            });
        }
    }

    const createUnexpectedError = () => {
        return new InvalidArgumentError("Expected account fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${root.children[childIndex]?.position?.start.line ?? "unknown"}. Try again with only fields in an unordered list (e.g. \`- Role: Member\`).`,
        });
    };

    let childIndex = 1;
    let fieldsList: List | null = null;

    while (childIndex < root.children.length) {
        const nextChild = root.children[childIndex]!;

        if (fieldsList === null && nextChild.type === "list" && !nextChild.ordered) {
            fieldsList = nextChild;
            childIndex++;
        } else {
            throw createUnexpectedError();
        }
    }

    let state: ApiAccountSpaceInactive | null = null;
    let role: ApiAccountSpace["role"] | null = null;
    let shortName: string | null = null;

    if (fieldsList) {
        const seenFields = new Set<AgentWebAccountFieldName>();

        for (const item of fieldsList.children) {
            const {label, value, remaining} = parseAgentWebAccountField(item);
            const fieldName = parseAgentWebAccountFieldName(normalizeAgentWebStaticText(label));

            if (fieldName === null) {
                throw new InvalidArgumentError("Unknown account field", {
                    displayMessage: errorDisplayMessage`Unexpected field ${curlyQuote(label)} on line ${item.position?.start.line ?? "unknown"}. Try again with \u201CState\u201D, \u201CRole\u201D, or \u201CShort name\u201D.`,
                });
            }

            if (seenFields.has(fieldName)) {
                throw new InvalidArgumentError("Duplicate account field", {
                    displayMessage: errorDisplayMessage`Field ${curlyQuote(label)} appears more than once on line ${item.position?.start.line ?? "unknown"}. Try again with each field only present once in the field list.`,
                });
            }

            seenFields.add(fieldName);

            if (remaining.length > 0) {
                throw new InvalidArgumentError("Unexpected markdown nested in account field", {
                    displayMessage: errorDisplayMessage`Unexpected markdown after field ${curlyQuote(label)} on line ${remaining[0]!.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with one unordered list item per field where the field name is followed by the field value with a colon in between (e.g. \`- Role: Member\`).`,
                });
            }

            switch (fieldName) {
                case "state": {
                    state = parseAgentWebAccountStateField(item.position, value);
                    break;
                }
                case "role": {
                    role = parseAgentWebAccountRoleField(item.position, value);
                    break;
                }
                case "shortName": {
                    shortName = printMarkdownPhrasingContentText(value).trim();
                    break;
                }
                default: {
                    throw exhaustive(fieldName);
                }
            }
        }
    }

    if (role === null) {
        throw new InvalidArgumentError("Missing account role", {
            displayMessage: errorDisplayMessage`Expected a \u201CRole\u201D field. Try again with a role like \`- Role: Member\`.`,
        });
    }

    return {
        type: "Account",
        name,
        state,
        role,
        shortName: shortName ?? name,
    };
}

function createAgentWebAccountFieldListItem(children: Array<PhrasingContent>): ListItem {
    return {
        type: "listItem",
        spread: false,
        children: [{type: "paragraph", children}],
    };
}

function printAgentWebAccountState(state: ApiAccountSpaceInactive): string {
    switch (state.type) {
        case "Removed":
            return "Removed from space";
        case "InvitePending":
            return "Invited, but hasn\u2019t accepted their invite";
        default:
            throw exhaustive(state);
    }
}

function parseAgentWebAccountFieldName(labelKey: string): AgentWebAccountFieldName | null {
    switch (labelKey) {
        case "state":
            return "state";
        case "role":
            return "role";
        case "short-name":
            return "shortName";
        default:
            return null;
    }
}

function parseAgentWebAccountField(item: ListItem) {
    const firstChild = item.children[0];

    const createError = () => {
        return new InvalidArgumentError("Invalid account fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${firstChild?.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with one unordered list item per field where the field name is followed by the field value with a colon in between (e.g. \`- Role: Member\`).`,
        });
    };

    if (firstChild?.type !== "paragraph") throw createError();

    const firstParagraphChild = firstChild.children[0];
    if (firstParagraphChild?.type !== "text") throw createError();

    const match = firstParagraphChild.value.match(/^([A-Za-z ]*):[ \t]*/);
    if (!match) throw createError();

    const label = match[1]!;
    const rest = firstParagraphChild.value.slice(match[0].length);
    const value: Array<PhrasingContent> = [];

    if (rest.length > 0) value.push({type: "text", value: rest});
    for (const child of firstChild.children.slice(1)) value.push(child);

    return {label, value, remaining: item.children.slice(1)};
}

function parseAgentWebAccountStateField(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiAccountSpaceInactive {
    const stateString = printMarkdownPhrasingContentText(value)
        .trim()
        .toLowerCase()
        // eslint-disable-next-line cyberworlds/string-quotes
        .replace(/\u2019/g, "'")
        .replace(/,/g, "");

    switch (stateString) {
        case "removed":
        case "removed from space":
            return {type: "Removed"};
        case "invited":
        // eslint-disable-next-line cyberworlds/string-quotes
        case "invited but hasn't accepted their invite":
            return {type: "InvitePending"};
        default: {
            const quotedValue = curlyQuote(value);

            throw new InvalidArgumentError("Invalid account state", {
                displayMessage: errorDisplayMessage`Unexpected state ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201CRemoved from space\u201D or \u201CInvited, but hasn\u2019t accepted their invite\u201D.`,
            });
        }
    }
}

function parseAgentWebAccountRoleField(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiAccountSpace["role"] {
    const roleString = printMarkdownPhrasingContentText(value).trim().toLowerCase();

    switch (roleString) {
        case "owner":
            return "Owner";
        case "admin":
            return "Admin";
        case "member":
            return "Member";
        default: {
            const quotedValue = curlyQuote(value);

            throw new InvalidArgumentError("Invalid account role", {
                displayMessage: errorDisplayMessage`Unexpected role ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201COwner\u201D, \u201CAdmin\u201D, or \u201CMember\u201D.`,
            });
        }
    }
}
