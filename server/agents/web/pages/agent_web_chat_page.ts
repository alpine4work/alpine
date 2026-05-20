import {Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPageBase,
    agentWebMessagingPageMessageNouns,
    printAgentWebMessagingPageBase,
    readAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export type AgentWebChatPage = AgentWebMessagingPageBase & {
    readonly type: "Chat";
};

export type AgentWebChatPageWithMetadata = AgentWebChatPage & {
    readonly metadata: AgentWebChatPageMetadata;
};

export type AgentWebChatPageMetadata = {
    readonly id: ChatId;
};

export async function readAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    {
        searchParams,
        limitLength,
        computeLength,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        computeLength: (page: AgentWebChatPageWithMetadata) => Promise<number>;
    },
): Promise<AgentWebChatPageWithMetadata> {
    const page = await readAgentWebMessagingPageBase<AgentWebChatPageWithMetadata>(
        context,
        agentWebMessagingPageMessageNouns,
        {
            room: {type: "Chat", id},
            defaultDirection: "End",
            searchParams,
            limitLength,
            computeLength,
            buildPage: page => ({...page, type: "Chat", metadata: {id}}),
            roomMetadataPromise: (async () => {
                const {
                    data: {chat},
                } = await context.api.get(context.span, "/chats/{id}", {
                    params: {path: {id}},
                });

                switch (chat.type) {
                    case "Direct": {
                        return {
                            target: {
                                type: "Chat",
                                id,
                                title: chat.title,
                            },
                            description: [{type: "Text", text: `in a chat with ${chat.title}`}],
                        };
                    }
                    case "Room": {
                        return {
                            target: {
                                type: "Chat",
                                id,
                                title: chat.name,
                            },
                            description: [{type: "Text", text: `in ${chat.name}`}],
                        };
                    }
                    default:
                        throw exhaustive(chat);
                }
            })(),
        },
    );

    return page;
}

export function printAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId,
    page: AgentWebChatPage,
): Promise<Root> {
    return printAgentWebMessagingPageBase(agentWebMessagingPageMessageNouns, storage, id, page);
}
