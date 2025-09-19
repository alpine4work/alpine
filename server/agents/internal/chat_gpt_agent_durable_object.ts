import {
    AgentDurableObjectBase,
    AgentDurableObjectEnv,
    ApiClient,
} from "~/server/agents/internal/agent_durable_object_base.js";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiMessageRoomPathObject,
    parseApiMessageRoomPath,
} from "~/server/api/specification/parse_api_path.js";
import {ApiBotWebhookEvent} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

type ChatGptAgentRoute = "NotFound";

export class ChatGptAgentDurableObject extends AgentDurableObjectBase<ChatGptAgentRoute> {
    constructor(state: DurableObjectState, env: AgentDurableObjectEnv) {
        super("ChatGptAgentService", state, env);
    }

    protected override _parseRoute(url: URL): [string, ChatGptAgentRoute | "Webhook"] {
        if (url.pathname === "/webhook") {
            return ["/webhook", "Webhook"];
        }

        return ["/*", "NotFound"];
    }

    protected override async _fetch(): Promise<Response> {
        return new Response("404 Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    }

    protected override async _webhook(
        apiClient: ApiClient,
        {spaceId, event}: {spaceId: SpaceId; event: ApiBotWebhookEvent},
    ) {
        const roomPathObject = parseApiMessageRoomPath(event.roomPath);

        const {data: message} = await getApiMessage(apiClient, roomPathObject, event.index);

        // Ignore non-content messages (e.g. deleted messages).
        if (message.payload.type !== "Content") return;

        const messageMarkdown = printApiContentToMarkdown(message.payload.content, {spaceId});

        // TODO(calebmer, #api): Remove this debug logging.
        // eslint-disable-next-line no-console
        console.log(
            "Message:\n\n" +
                messageMarkdown
                    .trim()
                    .split("\n")
                    .map(line => `  ${line}`)
                    .join("\n") +
                "\n",
        );
    }
}

function getApiMessage(
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    index: number,
) {
    switch (roomPathObject.type) {
        case "Chat": {
            return apiClient.GET("/chats/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.chatId, index}},
            });
        }
        case "DocumentCommentThread": {
            return apiClient.GET("/documents/{id}/threads/{threadId}/messages/{index}", {
                params: {
                    path: {
                        id: roomPathObject.documentId,
                        threadId: roomPathObject.commentThreadId,
                        index,
                    },
                },
            });
        }
        case "Post": {
            return apiClient.GET("/posts/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.postId, index}},
            });
        }
        case "Task": {
            return apiClient.GET("/tasks/{id}/messages/{index}", {
                params: {path: {id: roomPathObject.taskId, index}},
            });
        }
        default:
            throw exhaustive(roomPathObject);
    }
}
