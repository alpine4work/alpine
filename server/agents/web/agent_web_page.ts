import {AgentWebChatPageWithMetadata} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {AgentWebDocumentPageWithMetadata} from "~/server/agents/web/pages/agent_web_document_page.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";

export type AgentWebPageWithMetadata =
    | AgentWebDocumentPageWithMetadata
    | AgentWebChatPageWithMetadata;

export type AgentWebPage = DistributiveOmit<AgentWebPageWithMetadata, "metadata">;

// NOCOMMIT: Formalize what is metadata? What is a page? What are these things?
// Leave a big comment.
export type AgentWebPageMetadata = AgentWebPageWithMetadata["metadata"];

// This checks that at the type system level `page.metadata.type === page.type`.
assertEqualTypes<
    {[Type in AgentWebPageWithMetadata["type"]]: Type},
    {
        [Type in AgentWebPageWithMetadata["type"]]: Extract<
            AgentWebPageWithMetadata,
            {type: Type}
        >["metadata"]["type"];
    }
>();
