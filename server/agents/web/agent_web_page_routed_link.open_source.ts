import {AgentWebPageRoutedLinkKeyObject} from "~/server/agents/web/agent_web_page_routed_link_key.open_source.js";
import {
    ApiAccountReference,
    ApiDocumentReference,
    ApiTaskReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.open_source.js";

/**
 * A link with some routing logic to determine what `AgentWebPage` to respond to a
 * `read` tool call with. See the detailed documentation comment on
 * `AgentWebPageLink` for more information.
 *
 * The actual routing logic lives in `routeAgentWebPageLinkPathname()`.
 */
export type AgentWebPageRoutedLink =
    | AgentWebPageSkillRoutedLink
    | AgentWebPageDocumentThreadRoutedLink
    | AgentWebPageTaskMessageListRoutedLink
    | AgentWebPageTaskSubtasksRoutedLink
    | AgentWebPageTaskViewRoutedLink
    | AgentWebPageInboxRoutedLink
    | AgentWebPageSpaceRoutedLink
    | AgentWebPageMyAccountRoutedLink;

assertAssignableTypes<AgentWebPageRoutedLink, AgentWebPageRoutedLinkKeyObject>();

export type AgentWebPageSkillRoutedLink = {
    readonly type: "Skill";
    readonly path: string;
    readonly content: string;
};

export type AgentWebPageDocumentThreadRoutedLink = {
    readonly type: "DocumentThread";
    readonly document: ApiDocumentReference;
    readonly id: DocumentCommentThreadId;
};

export type AgentWebPageTaskMessageListRoutedLink = {
    readonly type: "TaskMessageList";
    readonly task: ApiTaskReference;
};

export type AgentWebPageTaskSubtasksRoutedLink = {
    readonly type: "TaskSubtasks";
    readonly task: ApiTaskReference;
};

export type AgentWebPageTaskViewRoutedLink = {
    readonly type: "TaskView";
};

export type AgentWebPageInboxRoutedLink = {
    readonly type: "Inbox";
    readonly account: ApiAccountReference;
};

export type AgentWebPageSpaceRoutedLink = {
    readonly type: "Space";
};

export type AgentWebPageMyAccountRoutedLink = {
    readonly type: "MyAccount";
};
