import {AgentWebPageLinkKeyObject} from "~/server/agents/web/agent_web_page_link_key.js";
import {ApiTaskStatus} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {
    getFileContentTypeNoun,
    getFileContentTypeStartOfSentenceNoun,
} from "~/shared/files/get_file_content_type_noun.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type AgentWebPageLink =
    | {
          readonly type: "Account";
          readonly id: AccountId;
          readonly title: string;
          readonly shortName: string;
          readonly botId?: BotId;
      }
    | {
          readonly type: "Channel";
          readonly id: ChannelId;
          readonly title: string;
      }
    | {
          readonly type: "Chat";
          readonly id: ChatId;
          readonly title: string;
      }
    | {
          readonly type: "ChatMessage";
          readonly id: ChatId;
          readonly index: number;
          readonly authorShortName: string;
          readonly bodySnippet: string;
      }
    | {
          readonly type: "Document";
          readonly id: DocumentId;
          readonly title: string;
      }
    | {
          readonly type: "DocumentMessage";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
          readonly authorShortName: string;
          readonly bodySnippet: string;
      }
    | {
          readonly type: "Post";
          readonly id: PostId;
          readonly title: string;
      }
    | {
          readonly type: "PostMessage";
          readonly id: PostId;
          readonly index: number;
          readonly authorShortName: string;
          readonly bodySnippet: string;
      }
    | {
          readonly type: "Task";
          readonly id: TaskId;
          readonly title: string;
          readonly status: ApiTaskStatus;
      }
    | {
          readonly type: "TaskMessage";
          readonly id: TaskId;
          readonly index: number;
          readonly authorShortName: string;
          readonly bodySnippet: string;
      }
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
          readonly title: string;
      }
    | {
          readonly type: "File";
          readonly id: FileId;
          readonly contentType: FileContentType;
          readonly contentLength: number;
      };

// NOCOMMIT: Use this??
type AgentWebPageMentionLink = Extract<
    AgentWebPageLink,
    {type: "Account" | "Channel" | "Chat" | "Document" | "Post" | "Task" | "TaskCollection"}
>;

assertAssignableTypes<AgentWebPageLink, AgentWebPageLinkKeyObject>();

/**
 * Prints a human readable path for an agent web page link. When a page link is
 * printed to Markdown this is the `path` part in `[label](path)`.
 * `printAgentWebPageLinkLabel(page)` prints the `label` part.
 *
 * Page paths must be unique. If two pages coincidentally have the same path then
 * we'll increment `dedupeNumber` and try to print a new path until we find a
 * unique path.
 */
export function printAgentWebPageLinkPathname(
    link: AgentWebPageLink,
    dedupeNumber: number,
): string {
    const path = actuallyPrintAgentWebPageLinkPathname(link, dedupeNumber);

    // Validation in development and tests that we actually use `dedupeNumber` to
    // create a unique path.
    if (process.env.NODE_ENV !== "production") {
        // The printed string should look like a URL pathname! Without search params and
        // without a hash.
        assert(path.startsWith("/"));
        assert(!path.includes("?"));
        assert(!path.includes("#"));

        assert(
            path !== actuallyPrintAgentWebPageLinkPathname(link, dedupeNumber + 1),
            "Printed agent web page path must include dedupe number",
        );
    }

    return path;
}

function actuallyPrintAgentWebPageLinkPathname(
    link: AgentWebPageLink,
    dedupeNumber: number,
): string {
    const dedupe = dedupeNumber > 1 ? `-${dedupeNumber}` : "";

    switch (link.type) {
        case "Account": {
            if (link.botId) {
                return `/bot/${slugify(link.title)}${dedupe}`;
            } else {
                return `/human/${slugify(link.title)}${dedupe}`;
            }
        }
        case "Channel": {
            return `/channel/${slugify(link.title)}${dedupe}`;
        }
        case "Chat": {
            return `/chat/${slugify(link.title)}${dedupe}`;
        }
        case "ChatMessage": {
            return `/chat/${slugify(link.authorShortName)}-${slugify(link.bodySnippet)}${dedupe}`;
        }
        case "Document": {
            return `/document/${slugify(link.title)}${dedupe}`;
        }
        case "DocumentMessage": {
            return `/document-thread/${slugify(link.authorShortName)}-${slugify(link.bodySnippet)}${dedupe}`;
        }
        case "Post": {
            return `/post/${slugify(link.title)}${dedupe}`;
        }
        case "PostMessage": {
            return `/post/${slugify(link.authorShortName)}-${slugify(link.bodySnippet)}${dedupe}`;
        }
        case "Task": {
            return `/task/${slugify(link.title)}${dedupe}`;
        }
        case "TaskMessage": {
            return `/task-comments/${slugify(link.authorShortName)}-${slugify(link.bodySnippet)}${dedupe}`;
        }
        case "TaskCollection": {
            return `/task-collection/${slugify(link.title)}${dedupe}`;
        }
        case "File": {
            return `/file/${slugify(getFileContentTypeNoun(link.contentType))}${dedupe}.${getFileContentTypePreferredExtension(link.contentType)}`;
        }
        default:
            throw exhaustive(link);
    }
}

function slugify(string: string) {
    // Replace ampersands with "and" so `D&D` becomes `d-and-d` instead of `d-d`
    string = string.replaceAll("&", " and ");

    string = string.slice(0, 50);

    string = convertToUrlPathnameSlug(string);

    if (string.length === 0) {
        string = "unknown";
    }

    return string;
}

/**
 * Prints a human readable label for an agent web page link. When a page link is
 * printed to Markdown this is the `label` part in `[label](path)`.
 * `printAgentWebPageLinkPath(page)` prints the `path` part.
 */
export function printAgentWebPageLinkLabel(link: AgentWebPageLink): string {
    switch (link.type) {
        case "Account":
        case "Channel":
        case "Document":
        case "TaskCollection": {
            return link.title;
        }
        case "Chat": {
            return link.title;
        }
        case "ChatMessage": {
            return `${link.authorShortName}: ${link.bodySnippet}`;
        }
        case "DocumentMessage": {
            return `${link.authorShortName}: ${link.bodySnippet}`;
        }
        case "Post": {
            return link.title;
        }
        case "PostMessage": {
            return `${link.authorShortName}: ${link.bodySnippet}`;
        }
        case "Task": {
            // Intentionally not including whether the task is active in this label. Keeping
            // things simple for the agent. The agent can read the task to see whether it's
            // active.
            return `${link.title} ${link.status.type === "Open" ? "(Open)" : "(Closed)"}`;
        }
        case "TaskMessage": {
            return `${link.authorShortName}: ${link.bodySnippet}`;
        }
        case "File": {
            // NOTE(calebmer): This link label isn't really printed anywhere to my knowledge.
            // Maybe we should update the types to make this impossible case actually
            // impossible?
            //
            // Come to think of it, I'm not sure the `ChatMessage` etc. link labels are ever
            // really printed? So this refactor to disallow printing labels for non-mention
            // links may make a lot of sense.
            return getFileContentTypeStartOfSentenceNoun(link.contentType);
        }
        default:
            throw exhaustive(link);
    }
}
