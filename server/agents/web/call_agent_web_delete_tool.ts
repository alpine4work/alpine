import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {UnimplementedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

export async function callAgentWebDeleteTool(
    context: AgentWebContext,
    options: {path: string},
): Promise<{isError: boolean; response: string}> {
    return await context.span.withSpan("Call agent web delete tool", async span => {
        try {
            return {
                isError: false,
                response: await actuallyCallAgentWebDeleteTool({...context, span}, options),
            };
        } catch (error) {
            span.addException(error);

            return {
                isError: true,
                response: printAgentWebError(`Couldn\u2019t delete ${quote(options.path)}`, error),
            };
        }
    });
}

async function actuallyCallAgentWebDeleteTool(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: AgentWebContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: {path: string},
): Promise<never> {
    throw new UnimplementedError("Delete tool hasn\u2019t been implemented yet", {
        displayMessage: errorDisplayMessage`The \`delete\` tool hasn\u2019t been implemented yet. Before allowing bots to delete stuff from Alpine, the Alpine team wants to build a trash feature so humans can recover anything that was accidentally deleted. Tell your human they need to manually delete things from Alpine, for now. For more information, contact ${errorDisplayMessage.supportLink}.`,
    });
}
