import {
    AgentContext,
    AgentDurableObjectBase,
    AgentDurableObjectEnv,
} from "~/server/agents/internal/agent_durable_object_base.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

type ChatGptAgentRoute = "Webhook" | "NotFound";

export class ChatGptAgentDurableObject extends AgentDurableObjectBase<ChatGptAgentRoute> {
    constructor(state: DurableObjectState, env: AgentDurableObjectEnv) {
        super("ChatGptAgentService", state, env);
    }

    protected override _parseRoute(url: URL): [string, ChatGptAgentRoute] {
        if (url.pathname === "/webhook") {
            return ["/webhook", "Webhook"];
        }

        return ["/*", "NotFound"];
    }

    protected override async _fetch(
        context: AgentContext,
        request: Request,
        route: ChatGptAgentRoute,
    ): Promise<Response> {
        switch (route) {
            case "NotFound": {
                return new Response("404 Not Found", {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            }
            case "Webhook": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                // TODO(calebmer, #api): Implement!
                // eslint-disable-next-line no-console
                console.log(await request.json());

                return new Response(null, {status: 200});
            }
            default:
                throw exhaustive(route);
        }
    }
}
