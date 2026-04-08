import {ApiTaskStatus} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
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
      };

/**
 * Used to determine if two links point to the same underlying data.
 */
export function printAgentWebPageLinkKey(key: AgentWebPageLink): string {
    switch (key.type) {
        case "Account":
            return `Account:${key.id}`;
        case "Channel":
            return `Channel:${key.id}`;
        case "Chat":
            return `Chat:${key.id}`;
        case "ChatMessage":
            return `ChatMessage:${key.id}-${key.index}`;
        case "Document":
            return `Document:${key.id}`;
        case "DocumentMessage":
            return `DocumentMessage:${key.id}-${key.threadId}-${key.index}`;
        case "Post":
            return `Post:${key.id}`;
        case "PostMessage":
            return `PostMessage:${key.id}-${key.index}`;
        case "Task":
            return `Task:${key.id}`;
        case "TaskMessage":
            return `TaskMessage:${key.id}-${key.index}`;
        case "TaskCollection":
            return `TaskCollection:${key.id}`;
        default:
            throw exhaustive(key);
    }
}

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
        default:
            throw exhaustive(link);
    }
}
