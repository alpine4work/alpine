import {AgentWebDocumentPageWithMetadata} from "~/server/agents/web/pages/agent_web_document_page.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";

export type AgentWebPageWithMetadata = AgentWebDocumentPageWithMetadata;

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
