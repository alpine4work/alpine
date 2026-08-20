import {produce} from "immer";
import {List, ListItem, Root, RootContent} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.open_source.js";
import {printAgentWebPageStoredLinkLabel} from "~/server/agents/web/agent_web_page_stored_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.open_source.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {printMarkdownPhrasingContentText} from "~/shared/api/content/print_markdown_phrasing_content_text.open_source.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.open_source.js";
import {ApiAccountReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/** The current space and all active or invited human members. */
export type AgentWebSpacePage = {
    readonly type: "Space";
    readonly name: string;
    readonly members: ReadonlyArray<ApiAccountReference>;
};

export type AgentWebSpacePageMetadata = {
    readonly type: "Space";
    readonly id: SpaceId;
};

export type AgentWebSpacePageWithMetadata = AgentWebSpacePage & {
    readonly metadata: AgentWebSpacePageMetadata;
};

export async function readAgentWebSpacePage(
    context: AgentWebContext,
    {printPage}: {printPage: (page: AgentWebSpacePage) => Promise<string>},
): Promise<{response: string; metadata: AgentWebSpacePageMetadata}> {
    const spaceResult = await context.api.get(context.span, "/spaces/{id}/accounts", {
        params: {path: {id: context.spaceId}},
    });

    const members = spaceResult.data.accounts
        .filter(account => !account.bot && account.space.inactive?.type !== "Removed")
        .map(intoApiAccountReference);

    const page: AgentWebSpacePageWithMetadata = {
        type: "Space",
        name: spaceResult.data.space.name,
        members,
        metadata: {type: "Space", id: context.spaceId},
    };

    return {
        response: await printPage(page),
        metadata: page.metadata,
    };
}

/** Space pages are informational and cannot be updated. */
export function updateAgentWebSpacePage(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: AgentWebContextWithoutStorage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPageMetadata: AgentWebSpacePageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPage: AgentWebSpacePage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    newPage: AgentWebSpacePage,
): never {
    throw new InvalidArgumentError("Can\u2019t update spaces", {
        displayMessage: errorDisplayMessage`Can\u2019t update spaces using the \`update\` tool for now. Try updating another page instead.`,
    });
}

export function normalizeAgentWebSpacePage<Page extends AgentWebSpacePage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            for (const member of page.members) normalizer.normalizeReference(member);
        });
    });
}

export async function printAgentWebSpacePage(
    storage: AgentWebSessionStorage,
    id: SpaceId,
    page: AgentWebSpacePage,
): Promise<Root> {
    const children: Array<RootContent> = [
        {
            type: "heading",
            depth: 1,
            children: [{type: "text", value: page.name}],
        },
        {
            type: "heading",
            depth: 2,
            children: [{type: "text", value: "Members"}],
        },
    ];

    if (page.members.length > 0) {
        children.push({
            type: "list",
            ordered: false,
            spread: false,
            children: await runAllPromises(
                page.members.map(async member => ({
                    type: "listItem" as const,
                    spread: false,
                    children: [
                        {
                            type: "paragraph" as const,
                            children: [
                                {
                                    type: "link" as const,
                                    url: await createAgentWebPageStoredLinkPathname(
                                        storage,
                                        member,
                                    ),
                                    children: [
                                        {
                                            type: "text" as const,
                                            value: printAgentWebPageStoredLinkLabel(member),
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                })),
            ),
        });
    }

    return {type: "root", children};
}

export async function parseAgentWebSpacePage(
    storage: AgentWebSessionStorage,
    id: SpaceId | null,
    root: Root,
): Promise<AgentWebSpacePage> {
    const nameHeading = root.children[0];
    if (nameHeading?.type !== "heading" || nameHeading.depth !== 1) {
        throw new InvalidArgumentError("Missing space name", {
            displayMessage: errorDisplayMessage`Expected the space name at the start of the page. Try again with a markdown h1 first (e.g. \`# Acme\`).`,
        });
    }

    const membersHeading = root.children[1];
    if (
        membersHeading?.type !== "heading" ||
        membersHeading.depth !== 2 ||
        normalizeAgentWebStaticText(printMarkdownPhrasingContentText(membersHeading.children)) !==
            "member"
    ) {
        throw new InvalidArgumentError("Missing space members section", {
            displayMessage: errorDisplayMessage`Expected a markdown h2 named \u201cMembers\u201d on line ${membersHeading?.position?.start.line ?? "unknown"}. Try again with \`## Members\` after the space name.`,
        });
    }

    let memberList: List | null = null;
    for (const child of root.children.slice(2)) {
        if (memberList === null && child.type === "list" && !child.ordered) {
            memberList = child;
        } else {
            throw new InvalidArgumentError("Unexpected markdown in space page", {
                displayMessage: errorDisplayMessage`Unexpected markdown on line ${child.position?.start.line ?? "unknown"}. Try again with only an unordered list of human links after \`## Members\`.`,
            });
        }
    }

    const members = await runAllPromises(
        (memberList?.children ?? []).map(member => parseAgentWebSpacePageMember(storage, member)),
    );

    return {
        type: "Space",
        name: printMarkdownPhrasingContentText(nameHeading.children),
        members,
    };
}

async function parseAgentWebSpacePageMember(
    storage: AgentWebSessionStorage,
    member: ListItem,
): Promise<ApiAccountReference> {
    const paragraph = member.children[0];
    const link = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;

    if (
        member.children.length !== 1 ||
        paragraph?.type !== "paragraph" ||
        paragraph.children.length !== 1 ||
        link?.type !== "link"
    ) {
        throw createAgentWebSpacePageMemberError(member);
    }

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);
    if (pageLinkResult?.pageLink.type !== "Account" || pageLinkResult.pageLink.bot !== undefined) {
        throw createAgentWebSpacePageMemberError(member);
    }

    return pageLinkResult.pageLink;
}

function createAgentWebSpacePageMemberError(member: ListItem): InvalidArgumentError {
    return new InvalidArgumentError("Expected a human space member link", {
        displayMessage: errorDisplayMessage`Expected a link to a human on line ${member.position?.start.line ?? "unknown"} (e.g. \`- [Alice](/human/alice)\`). You may only list humans you\u2019ve previously seen. Try calling the \`search\` tool to find the human you want to list, then try again with their link.`,
    });
}
