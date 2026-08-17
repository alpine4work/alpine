import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function createAgentWebPageLinkApiMentionReferenceIfPossible(
    link: AgentWebPageLink,
    spaceId: SpaceId,
): {type: "MentionReference"; reference: ApiMentionReferenceResponse} | {type: "Url"; url: string} {
    // Build each reference explicitly instead of passing `link` through. Stored links
    // may carry extra hydrated data beyond their declared reference type (e.g. the
    // search tool stores post links with the search result's `author`), and the API
    // rejects request bodies with unexpected properties
    // (`additionalProperties: false`).
    switch (link.type) {
        case "Account": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Account",
                    id: link.id,
                    title: link.title,
                    shortName: link.shortName,
                    bot: link.bot === undefined ? undefined : {id: link.bot.id},
                },
            };
        }
        case "Channel": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Channel",
                    id: link.id,
                    title: link.title,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "Chat": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Chat",
                    id: link.id,
                    title: link.title,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "Document": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Document",
                    id: link.id,
                    title: link.title,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "Post": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Post",
                    id: link.id,
                    title: link.title,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "Task": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Task",
                    id: link.id,
                    title: link.title,
                    status: link.status,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "TaskCollection": {
            return {
                type: "MentionReference",
                reference: {type: "TaskCollection", id: link.id, title: link.title},
            };
        }
        case "Site": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Site",
                    id: link.id,
                    title: link.title,
                    deleted: link.deleted,
                    private: link.private,
                },
            };
        }
        case "ChatMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/chat/${link.id}?message=${link.index}`,
            };
        }
        case "DocumentThread": {
            return {
                type: "Url",
                url: `https://alpine.inc/doc/${link.document.id}?thread=${link.id}`,
            };
        }
        case "DocumentMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/doc/${link.document.id}?thread=${link.id}&comment=${link.index}`,
            };
        }
        case "PostMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/post/${link.id}?comment=${link.index}`,
            };
        }
        case "TaskMessage": {
            return {
                type: "Url",
                url: `https://alpine.inc/task/${link.id}?comment=${link.index}`,
            };
        }
        case "File": {
            return {
                type: "Url",
                url: `https://alpine.inc/file/${link.id}`,
            };
        }
        case "TaskMessageList":
        case "TaskSubtasks": {
            return {
                type: "MentionReference",
                reference: {
                    type: "Task",
                    id: link.task.id,
                    title: link.task.title,
                    status: link.task.status,
                    deleted: link.task.deleted,
                    private: link.task.private,
                },
            };
        }
        case "Inbox": {
            return {
                type: "Url",
                url: `https://alpine.inc/inbox/${spaceId}`,
            };
        }
        case "Skill": {
            // If the agent writes a skill link then output that as a URL to the skill file in
            // our open source mirror so the user can go open that file and see what the agent
            // was talking about.
            return {
                type: "Url",
                url: `https://github.com/alpine4work/alpine/blob/main/skills/alpine/${link.path}.md`,
            };
        }
        case "MyAccount": {
            // If a bot writes `/bot/me` in its Markdown, this isn't a great URL but oh well.
            // It's actually quite hard to plumb down the `BotId` we need down here. Since we
            // think this is a rare case we accept the generic URL for now.
            return {
                type: "Url",
                url: `https://alpine.inc/settings/${spaceId}/bots`,
            };
        }
        default:
            throw exhaustive(link);
    }
}
