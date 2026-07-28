import {
    ApiDocumentReferenceResponse,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

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
    | AgentWebPageTaskSubtasksRoutedLink;

export type AgentWebPageSkillRoutedLink = {
    readonly type: "Skill";
    readonly path: string;
    readonly content: string;
};

export type AgentWebPageDocumentThreadRoutedLink = {
    readonly type: "DocumentThread";
    readonly document: ApiDocumentReferenceResponse;
    readonly threadId: DocumentCommentThreadId;
};

export type AgentWebPageTaskMessageListRoutedLink = {
    readonly type: "TaskMessageList";
    readonly task: ApiTaskReferenceResponse;
};

export type AgentWebPageTaskSubtasksRoutedLink = {
    readonly type: "TaskSubtasks";
    readonly task: ApiTaskReferenceResponse;
};
