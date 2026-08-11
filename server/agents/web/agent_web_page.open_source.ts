import {AgentWebAccountPageWithMetadata} from "~/server/agents/web/pages/agent_web_account_page.open_source.js";
import {AgentWebChannelPageWithMetadata} from "~/server/agents/web/pages/agent_web_channel_page.open_source.js";
import {AgentWebChatPageWithMetadata} from "~/server/agents/web/pages/agent_web_chat_page.open_source.js";
import {AgentWebDocumentPageWithMetadata} from "~/server/agents/web/pages/agent_web_document_page.open_source.js";
import {AgentWebDocumentThreadPageWithMetadata} from "~/server/agents/web/pages/agent_web_document_thread_page.open_source.js";
import {AgentWebInboxPageWithMetadata} from "~/server/agents/web/pages/agent_web_inbox_page.open_source.js";
import {AgentWebPostPageWithMetadata} from "~/server/agents/web/pages/agent_web_post_page.open_source.js";
import {AgentWebTaskCollectionPageWithMetadata} from "~/server/agents/web/pages/agent_web_task_collection_page.open_source.js";
import {AgentWebTaskMessageListPageWithMetadata} from "~/server/agents/web/pages/agent_web_task_message_list_page.open_source.js";
import {AgentWebTaskPageWithMetadata} from "~/server/agents/web/pages/agent_web_task_page.open_source.js";
import {AgentWebTaskSubtasksPageWithMetadata} from "~/server/agents/web/pages/agent_web_task_subtasks_page.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";

/**
 * The underlying abstract representation of content manipulated by the `create`,
 * `read`, `update`, `scroll`, `find`, etc. tools. The agent manipulates content
 * through Markdown strings. We print that Markdown string from an `AgentWebPage`
 * and we parse that Markdown string back into an `AgentWebPage`. The agent
 * manipulates Markdown strings and we interpret those manipulations through this
 * structured abstract representation.
 *
 * For example, when an agent uses the `update` tool we have the old Markdown
 * string and the new Markdown string. We parse the old Markdown string into an
 * `AgentWebPage` and we parse the new Markdown string into an `AgentWebPage`. Then
 * we diff the old `AgentWebPage` with the new `AgentWebPage` and turn that into
 * API calls.
 *
 * All content returned by `read` has an underlying `AgentWebPage` representation.
 * We must maintain correct parsing/printing implementations for all the
 * `AgentWebPage`s we return.
 */
export type AgentWebPage = DistributiveOmit<AgentWebPageWithMetadata, "metadata">;

/**
 * Additional internal bookeeping data associated with an `AgentWebPage` that's
 * invisible to the agent. Metadata isn't exposed via the `read` tool but is needed
 * to power the `update` tool.
 *
 * For example, document version is included in metadata. We don't include the
 * document version in the Markdown string we return from `read` (the agent doesn't
 * need to see the version). However, we need the document version when calling the
 * `update` tool to prevent clobbering updates made collaboratively by other humans
 * or agents.
 */
export type AgentWebPageMetadata = AgentWebPageWithMetadata["metadata"];

/**
 * `AgentWebPage` with a `metadata` property of `AgentWebPageMetadata`.
 *
 * Mostly a convenience. Allows you to switch on `page.type` and have the right
 * `page.metadata.type` come along with it.
 */
export type AgentWebPageWithMetadata =
    | AgentWebAccountPageWithMetadata
    | AgentWebDocumentPageWithMetadata
    | AgentWebDocumentThreadPageWithMetadata
    | AgentWebInboxPageWithMetadata
    | AgentWebChannelPageWithMetadata
    | AgentWebChatPageWithMetadata
    | AgentWebPostPageWithMetadata
    | AgentWebTaskPageWithMetadata
    | AgentWebTaskCollectionPageWithMetadata
    | AgentWebTaskMessageListPageWithMetadata
    | AgentWebTaskSubtasksPageWithMetadata
    | AgentWebSkillPageWithMetadata
    | AgentWebMyAccountPageWithMetadata;

export type AgentWebSkillPageWithMetadata = {
    readonly type: "Skill";
    readonly metadata: {type: "Skill"};
};

export type AgentWebMyAccountPageWithMetadata = {
    readonly type: "MyAccount";
    readonly metadata: {type: "MyAccount"};
};

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
