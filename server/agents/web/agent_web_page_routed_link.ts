import {ApiTaskReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";

/**
 * A link with some routing logic to determine what `AgentWebPage` to respond to a
 * `read` tool call with. See the detailed documentation comment on
 * `AgentWebPageLink` for more information.
 *
 * The actual routing logic lives in `routeAgentWebPageLinkPathname()`.
 */
export type AgentWebPageRoutedLink = {
    readonly type: "TaskMessageList";
    readonly task: ApiTaskReferenceResponse;
};
