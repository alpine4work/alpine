import {Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageWithMetadata,
    agentWebMessagingPageMessageNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {
    readAgentWebMessagingPage,
    readAgentWebMessagingPageAroundMessage,
} from "~/server/agents/web/pages/messaging/read_agent_web_messaging_page.js";
import {truncateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/truncate_agent_web_messaging_page.js";
import {updateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
import {intoApiAccountTarget} from "~/shared/api/specification/into_api_account_target.js";
import {
    ApiContentInlineElementResponse,
    ApiMentionTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export type AgentWebChatPage = AgentWebMessagingPage & {
    readonly type: "Chat";
};

export type AgentWebChatPageWithMetadata = AgentWebChatPage & {
    readonly metadata: AgentWebChatPageMetadata;
};

export type AgentWebChatPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "Chat";
    readonly id: ChatId;
};

function buildAgentWebChatPage(
    page: AgentWebMessagingPageWithMetadata,
    id: ChatId,
): AgentWebChatPageWithMetadata {
    return {
        ...page,
        type: "Chat",
        metadata: buildAgentWebChatPageMetadata(page.metadata, id),
    };
}

function buildAgentWebChatPageMetadata(
    metadata: AgentWebMessagingPageMetadata,
    id: ChatId,
): AgentWebChatPageMetadata {
    return {...metadata, type: "Chat", id};
}

export async function readAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    {
        searchParams,
        limitLength,
        printPage,
        createPageLinkPathname,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChatPageMetadata}> {
    const result = await readAgentWebMessagingPage(agentWebMessagingPageMessageNouns, context, {
        room: {type: "Chat", id},
        roomMetadataPromise: getChatRoomMetadata(context, id),
        defaultDirection: "End",
        searchParams,
        limitLength,
        printPage: page => printPage(buildAgentWebChatPage(page, id)),
        createPageLinkPathname,
    });

    return {
        response: result.response,
        metadata: buildAgentWebChatPageMetadata(result.metadata, id),
    };
}

export async function readAgentWebChatMessagePage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    index: number,
    {
        limitLength,
        printPage,
        createPageLinkPathname,
    }: {
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChatPageMetadata}> {
    const result = await readAgentWebMessagingPageAroundMessage(
        agentWebMessagingPageMessageNouns,
        context,
        {
            room: {type: "Chat", id},
            roomMetadataPromise: getChatRoomMetadata(context, id),
            around: {startMessageIndex: index, endMessageIndex: index + 1},
            limitLength,
            printPage: page => printPage(buildAgentWebChatPage(page, id)),
            createPageLinkPathname,
        },
    );

    return {
        response: result.response,
        metadata: buildAgentWebChatPageMetadata(result.metadata, id),
    };
}

export async function updateAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    pathname: string,
    oldPageMetadata: AgentWebChatPageMetadata,
    oldPage: AgentWebChatPage,
    newPage: AgentWebChatPage,
): Promise<AgentWebChatPageMetadata & {type: "Chat"}> {
    await updateAgentWebMessagingPage(agentWebMessagingPageMessageNouns, context, {
        pathname,
        room: {type: "Chat", id: oldPageMetadata.id},
        oldPage,
        newPage,
    });

    return {type: "Chat", id: oldPageMetadata.id};
}

async function getChatRoomMetadata(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
): Promise<{
    target: ApiMentionTargetResponse;
    description: ReadonlyArray<ApiContentInlineElementResponse>;
}> {
    const {
        data: {chat},
    } = await context.api.get(context.span, "/chats/{id}", {
        params: {path: {id}},
    });

    switch (chat.type) {
        case "Direct": {
            const mentions = chat.members.map((member): ApiContentInlineElementResponse => {
                return {type: "Mention", target: intoApiAccountTarget(member.account)};
            });

            let mentionsPrettyConjunctionList: Array<ApiContentInlineElementResponse>;

            assert(mentions.length > 0);

            if (mentions.length === 1) {
                mentionsPrettyConjunctionList = mentions;
            } else if (mentions.length === 2) {
                mentionsPrettyConjunctionList = [
                    mentions[0]!,
                    {type: "Text", text: " and "},
                    mentions[1]!,
                ];
            } else {
                mentionsPrettyConjunctionList = [
                    ...interleaveArray(
                        mentions.slice(0, -1),
                        cast<ApiContentInlineElementResponse>({type: "Text", text: ", "}),
                    ),
                    {type: "Text", text: ", and "},
                    mentions[mentions.length - 1]!,
                ];
            }

            return {
                target: {type: "Chat", id, title: chat.title},
                description: [{type: "Text", text: `in a chat with ${chat.title}`}],
            };
        }
        case "Room": {
            return {
                target: {type: "Chat", id, title: chat.name},
                description: [{type: "Text", text: `in ${chat.name}`}],
            };
        }
        default:
            throw exhaustive(chat);
    }
}

export function normalizeAgentWebChatPage<Page extends AgentWebChatPage>(page: Page): Page {
    return normalizeAgentWebMessagingPage(page);
}

export async function printAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId,
    page: AgentWebChatPage,
): Promise<Root> {
    return await printAgentWebMessagingPage(agentWebMessagingPageMessageNouns, storage, id, page);
}

export async function parseAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId | null,
    root: Root,
): Promise<AgentWebChatPage> {
    const page = await parseAgentWebMessagingPage(
        agentWebMessagingPageMessageNouns,
        storage,
        id,
        root,
    );

    return {...page, type: "Chat"};
}
