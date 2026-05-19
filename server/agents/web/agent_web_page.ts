import {AgentWebChatPageWithMetadata} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {AgentWebDocumentPageWithMetadata} from "~/server/agents/web/pages/agent_web_document_page.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

export type AgentWebPageWithMetadata =
    | AgentWebDocumentPageWithMetadata
    | AgentWebChatPageWithMetadata;

export type AgentWebPage = DistributiveOmit<AgentWebPageWithMetadata, "metadata">;

// NOCOMMIT: Formalize what is metadata? What is a page? What are these things?
// Leave a big comment.
export type AgentWebPageMetadata = {
    [Type in AgentWebPageWithMetadata["type"]]: MergeObjectIntersection<
        {readonly type: Type} & Extract<AgentWebPageWithMetadata, {readonly type: Type}>["metadata"]
    >;
}[AgentWebPageWithMetadata["type"]];

export function intoAgentWebPageMetadata(page: AgentWebPageWithMetadata): AgentWebPageMetadata {
    return {type: page.type, ...page.metadata} as AgentWebPageMetadata;
}
