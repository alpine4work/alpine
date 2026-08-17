import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {Link, ListItem, Paragraph, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {printMarkdownPhrasingContentText} from "~/shared/api/content/print_markdown_phrasing_content_text.open_source.js";
import {
    ApiAccountReference,
    ApiAccountReferenceResponse,
    ApiInboxEntryResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {deserializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone, formatTimeZoneAbbreviation} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * The status filter applied to the inbox. `New` entries are unread/undone and
 * `Done` entries have been resolved. Selected via the `?status` URL search param
 * (see the `/spaces/{id}/accounts/{accountId}/inbox/entries` API), defaulting to
 * `New`.
 */
export type AgentWebInboxPageStatus = "New" | "Done";

/**
 * A single inbox entry (notification). Printed as a linked list item, like
 * `AgentWebTaskQueryPageTask`.
 *
 * Each entry links to the content the notification is about. For the
 * message/comment notifications (`Chat`, `Post`, `DocumentThread`, `TaskMessages`)
 * we link to the specific message; for the batched notifications
 * (`CreatedChannelPosts`, `CreatedDocumentThreads`) we link to the parent channel
 * or document. We prefer message links because they route straight to the relevant
 * comment. For the entity links we can't avoid (`Post` without a message,
 * `Channel`, `Document`) we reuse the rendered notification `title` as the link
 * label; following the link routes to the real page and redirects to its canonical
 * path. When the referenced entity is private or deleted there's nothing to link
 * to, so the entry renders its title as plain text.
 */
export type AgentWebInboxPageEntry = {
    /**
     * The link to the content this notification is about, or `null` when the entity is
     * private (the account lost access) or deleted and there's nothing to link to.
     * When `null` the notification `title` — which already reads like "…a private
     * channel" — is printed as plain text instead of a link.
     */
    readonly link: AgentWebPageLink | null;

    /**
     * The rendered notification title, e.g. "Caleb sent you a message". Account names
     * in the title are flattened to their short name.
     */
    readonly title: string;

    /**
     * The latest message snippet shown under the title, prefixed with its author's
     * short name (e.g. "Caleb: See you then"). `null` when the entry has no message.
     */
    readonly preview: string | null;

    /**
     * The entry's notification time, pre-formatted for display in the reader's time
     * zone (e.g. "May 14th at 10:55am EDT").
     */
    readonly timeAttribute: string;
    /**
     * The number of loud notifications for this entry.
     */
    readonly loudNotificationCount: number;
};

/**
 * Pagination state carried in the "Next page" link's URL search params so the next
 * `read` knows where to resume. See `AgentWebTaskQueryPagePagination` /
 * `readAgentWebChannelPage` for the paginate-across-pages pattern.
 *
 * `nextCursor` is the opaque `?after` resume cursor. The `?status` filter is
 * preserved from the page-level `AgentWebInboxPage.status` when printing the link.
 */
export type AgentWebInboxPagePagination = {
    readonly nextCursor: string;
};

/**
 * The inbox is a human account's unified notification feed.
 *
 * The inbox is addressed by the human whose inbox it is: the `/human/{name}/inbox`
 * routed link derives the human's `AccountId` from the stored `/human/{name}`
 * account link (like `/task/{name}/comments` derives a `TaskId` from
 * `/task/{name}`). That `AccountId` is the page's only variable identifier — the
 * space is ambient (`context.spaceId` at the API boundary, `storage.spaceId`
 * inside print/parse), so this behaves like an ordinary single-id page.
 *
 * Because notifications are unbounded over time, the inbox paginates across pages
 * via URL search params rather than scrolling within one page.
 */
export type AgentWebInboxPage = {
    readonly type: "Inbox";
    /**
     * The human whose inbox this is. Printed as a link in the preamble (so it
     * round-trips) and used to build the "Next page" link back to
     * `/human/{name}/inbox`.
     */
    readonly account: ApiAccountReferenceResponse;
    /** The `?status` filter this page was read with (defaults to `New`). */
    readonly status: AgentWebInboxPageStatus;
    readonly pagination: AgentWebInboxPagePagination | null;
    readonly entries: ReadonlyArray<AgentWebInboxPageEntry>;
    readonly isEndOfEntries: boolean;
};

export type AgentWebInboxPageMetadata = {
    readonly type: "Inbox";
    readonly id: AccountId;
};

export type AgentWebInboxPageWithMetadata = AgentWebInboxPage & {
    readonly metadata: AgentWebInboxPageMetadata;
};

/**
 * How many inbox entries to request per `inbox/entries` API call. We accumulate
 * batches into a single page until it overshoots `limitLength`, so this is just
 * the granularity at which we can resume (the inbox API has no per-entry cursors).
 */
export const agentWebInboxPageApiEntriesBatchCount = 10;

/**
 * Reads a human account's inbox and prints it to Markdown.
 *
 * Fetches batches from `GET /spaces/{id}/accounts/{accountId}/inbox/entries`
 * (filtered by the `?status` search param, resuming from the `?after` cursor) and
 * accumulates them into a single page, printing with `printPage` after each batch.
 * We keep filling the page with more batches while it fits within `limitLength`
 * and the API returns a `nextCursor`. Once a batch would overshoot we fall back to
 * the last page that fit, whose "Next page" link already resumes at the
 * overshooting batch. Unlike `readAgentWebChannelPage`, the inbox API has no
 * per-entry cursors, so we can only resume at batch boundaries rather than
 * truncating mid-batch.
 */
export async function readAgentWebInboxPage(
    context: AgentWebContext,
    account: ApiAccountReference,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebInboxPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebInboxPageMetadata}> {
    const {status, afterCursor} = parseAgentWebInboxPageSearchParams(searchParams);

    // Entry times are formatted relative to "now" in the reader's time zone.
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    const metadata: AgentWebInboxPageMetadata = {type: "Inbox", id: account.id};
    const entries: Array<AgentWebInboxPageEntry> = [];

    // The cursor to resume from at the start of the batch we're about to fetch.
    let cursor: string | null = afterCursor;

    // The last rendered page that fit within `limitLength`. Its "Next page" link
    // already resumes at the next unfetched batch, so if a later batch overshoots we
    // return this instead.
    let committed: {response: string; metadata: AgentWebInboxPageMetadata} | null = null;

    const accountReferencePromise = context.api.get(context.span, "/accounts/{id}-reference", {
        params: {path: {id: account.id}},
    });

    while (true) {
        const {
            data: {entries: entryBatch, nextCursor},
        } = await context.api.get(context.span, "/spaces/{id}/accounts/{accountId}/inbox/entries", {
            params: {
                path: {id: context.spaceId, accountId: account.id},
                query: {
                    status,
                    limit: agentWebInboxPageApiEntriesBatchCount,
                    cursor: cursor ?? undefined,
                },
            },
        });

        for (const entry of entryBatch) {
            entries.push(
                intoAgentWebInboxPageEntry(entry, {
                    timeZone: context.timeZone,
                    contextTime,
                    contextDate,
                }),
            );
        }

        const page: AgentWebInboxPageWithMetadata = {
            type: "Inbox",
            account: (await accountReferencePromise).data.reference,
            status,
            pagination: nextCursor !== null ? {nextCursor} : null,
            entries: entries.slice(),
            isEndOfEntries: nextCursor === null,
            metadata,
        };

        const response = await printPage(page);

        // The accumulated entries overshoot the limit. Fall back to the last page that
        // fit, whose "Next page" link already resumes at this batch.
        if (response.length > limitLength && committed !== null) {
            return committed;
        }

        // Either we're at the end of the inbox, or this is the first batch and it already
        // overshoots and can't be split. Return what we have.
        if (nextCursor === null || response.length > limitLength) {
            return {response, metadata};
        }

        // This batch fit and there may be more entries. Remember it and keep filling the
        // page up to `limitLength` with the next batch.
        committed = {response, metadata};
        cursor = nextCursor;
    }
}

/**
 * Reads the `?status` (defaulting to `New`) and `?after` (opaque resume cursor)
 * URL search params, rejecting any others. See
 * `parseAgentWebChannelPageSearchParams`.
 */
function parseAgentWebInboxPageSearchParams(searchParams: URLSearchParams): {
    status: AgentWebInboxPageStatus;
    afterCursor: string | null;
} {
    for (const key of searchParams.keys()) {
        if (key !== "status" && key !== "after") {
            throw new InvalidArgumentError("Unsupported inbox page search param", {
                displayMessage: errorDisplayMessage`Expected only the \`?status\` and \`?after\` URL search params for inbox pages. Try again with \`?status\`/\`?after\` or omit the search params.`,
            });
        }
    }

    const statusValue = searchParams.get("status")?.trim().toLowerCase();
    let status: AgentWebInboxPageStatus;

    if (statusValue === undefined || statusValue === "" || statusValue === "new") {
        status = "New";
    } else if (statusValue === "done") {
        status = "Done";
    } else {
        throw new InvalidArgumentError("Invalid inbox status search param", {
            displayMessage: errorDisplayMessage`Expected the \`?status\` URL search param to be \u201CNew\u201D or \u201CDone\u201D. Try again with \`?status=New\` or \`?status=Done\`.`,
        });
    }

    return {status, afterCursor: searchParams.get("after")};
}

/**
 * Converts an `ApiInboxEntryResponse` into an `AgentWebInboxPageEntry`, choosing
 * the link target for each entry type (see `AgentWebInboxPageEntry`).
 */
export function intoAgentWebInboxPageEntry(
    entry: ApiInboxEntryResponse,
    {
        timeZone,
        contextTime,
        contextDate,
    }: {timeZone: TimeZone; contextTime: Date; contextDate: CalendarDate},
): AgentWebInboxPageEntry {
    const title = entry.title
        .map(item => (item.type === "Text" ? item.text : item.account.shortName))
        .join("");

    const formattedTime = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        contextDate,
        deserializeDateString(entry.time),
        {withLongMonth: true},
    );
    const timeAttribute = `${formattedTime} ${formatTimeZoneAbbreviation(timeZone, contextTime)}`;

    // The API returns `preview` as rich text items: an `Account` item for the message
    // author followed by a `Text` item with the bare snippet. Split it back into the
    // author and snippet. This author is the message author, which can differ from
    // `featured`/`otherAccount` (e.g. when you sent the last message).
    let previewAuthorShortName: string | undefined;
    const previewSnippetParts: Array<string> = [];
    for (const item of entry.preview ?? []) {
        switch (item.type) {
            case "Account":
                previewAuthorShortName ??= item.account.shortName;
                break;
            case "Text":
                previewSnippetParts.push(item.text);
                break;
            default:
                throw exhaustive(item);
        }
    }
    const previewSnippet = previewSnippetParts.join("");

    // The display snippet keeps the author prefix (e.g. "Caleb: See you then"); `null`
    // when the entry has no message.
    const preview =
        entry.preview === undefined
            ? null
            : previewAuthorShortName !== undefined
              ? `${previewAuthorShortName}: ${previewSnippet}`
              : previewSnippet;

    // A message stored link slugs its pathname from `authorShortName` plus `preview`.
    // Use the message author and the bare snippet so the slug reads `author-snippet`
    // (matching the search tool) instead of doubling the author. Fall back to the
    // notification title when the entry has no message snippet.
    const authorShortName = previewAuthorShortName ?? entry.featured.account.shortName;
    const messagePreview = previewSnippet !== "" ? previewSnippet : title;

    // Entity references resolve to a link when the account can see the entity and to
    // `null` when it's private/deleted (there's nothing to link to, so we print the
    // title as plain text). `Chat` and `TaskMessages` link to a specific message via
    // `previewMessage`, and a `Post` with a `previewMessage` and a `DocumentThread` do
    // too, but only when the underlying entity is still accessible.
    let link: AgentWebPageLink | null;
    switch (entry.type) {
        case "Chat":
            link =
                entry.chat.private || entry.chat.deleted
                    ? null
                    : {
                          type: "ChatMessage",
                          id: entry.chat.id,
                          index: entry.previewMessage.index,
                          authorShortName,
                          preview: messagePreview,
                      };
            break;
        case "Post":
            link =
                entry.post.private || entry.post.deleted
                    ? null
                    : entry.previewMessage !== undefined
                      ? {
                            type: "PostMessage",
                            id: entry.post.id,
                            index: entry.previewMessage.index,
                            authorShortName,
                            preview: messagePreview,
                        }
                      : {type: "Post", id: entry.post.id, title: entry.post.title};
            break;
        case "CreatedChannelPosts":
            link =
                entry.channel.private || entry.channel.deleted
                    ? null
                    : {type: "Channel", id: entry.channel.id, title: entry.channel.title};
            break;
        case "CreatedDocumentThreads":
            link =
                entry.document.private || entry.document.deleted
                    ? null
                    : {type: "Document", id: entry.document.id, title: entry.document.title};
            break;
        case "DocumentThread":
            link =
                entry.document.private || entry.document.deleted
                    ? null
                    : {
                          type: "DocumentMessage",
                          document: {type: "Document", id: entry.document.id},
                          id: entry.thread.id,
                          index: entry.previewMessage.index,
                          authorShortName,
                          preview: messagePreview,
                      };
            break;
        case "TaskMessages":
            link =
                entry.task.private || entry.task.deleted
                    ? null
                    : {
                          type: "TaskMessage",
                          id: entry.task.id,
                          index: entry.previewMessage.index,
                          authorShortName,
                          preview: messagePreview,
                      };
            break;
        default:
            throw exhaustive(entry);
    }

    return {
        link,
        title,
        preview,
        timeAttribute,
        loudNotificationCount: entry.loudNotificationCount,
    };
}

/**
 * Inboxes are read-only, so we throw an `InvalidArgumentError` with a helpful
 * `displayMessage`. This may change if we ever allow agents to manually mark
 * entries as `Done`.
 */
export function updateAgentWebInboxPage(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: AgentWebContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPageMetadata: AgentWebInboxPageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    oldPage: AgentWebInboxPage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    newPage: AgentWebInboxPage,
): never {
    throw new InvalidArgumentError("Can\u2019t update inboxes", {
        displayMessage: errorDisplayMessage`Can\u2019t update inboxes using the \`update\` tool. Tell the user they\u2019ll need to dismiss any notifications themselves from their inbox. Try updating another page instead.`,
    });
}

/** The link text used to paginate to the next inbox page. */
export const agentWebInboxPageNextPageLinkText = "Next page »";

/**
 * The marker printed at the bottom of the last inbox page. Status-aware (e.g. "End
 * of new notifications.") so it reads naturally under the matching preamble.
 */
function agentWebInboxPageEndOfEntriesText(status: AgentWebInboxPageStatus): string {
    switch (status) {
        case "New":
            return "End of new notifications.";
        case "Done":
            return "End of done notifications.";
        default:
            throw exhaustive(status);
    }
}

/** A regexp matching either status's end-of-entries marker. */
const agentWebInboxPageEndOfEntriesRegExp = /^End of (?:new|done) notifications\.?$/;

/**
 * Canonicalizes the page for print/parse round-trip comparisons. The inbox is
 * read-only and its links are already canonical (each entry stores exactly the
 * link it was read with), so there's nothing to normalize.
 */
export function normalizeAgentWebInboxPage<Page extends AgentWebInboxPage>(page: Page): Page {
    return page;
}

/**
 * Prints an inbox page to an mdast tree.
 *
 * A short preamble names the `?status` filter (so it round-trips) and links to a
 * toggle for the other filter, followed by the entries as a loose list, then a
 * "Next page" link when `page.pagination` is set or an "End of … notifications."
 * marker when `page.isEndOfEntries` is true. `account` is the human whose inbox
 * this is, used to build the toggle and "Next page" links back to
 * `/human/{name}/inbox`.
 */
export async function printAgentWebInboxPage(
    storage: AgentWebSessionStorage,
    id: AccountId,
    page: AgentWebInboxPage,
): Promise<Root> {
    assert(id === page.account.id);

    const children: Array<RootContent> = [
        await printAgentWebInboxPagePreambleParagraph(storage, page.account, page.status),
    ];

    if (page.entries.length > 0) {
        children.push({
            type: "list",
            ordered: false,
            spread: true,
            children: await runAllPromises(
                page.entries.map(entry => printAgentWebInboxPageEntryListItem(storage, entry)),
            ),
        });
    }

    if (page.pagination !== null) {
        const pathname = await createAgentWebPageLinkPathname(storage, {
            type: "Inbox",
            account: page.account,
        });

        const search =
            page.status === "Done"
                ? `after=${encodeURIComponent(page.pagination.nextCursor)}&status=Done`
                : `after=${encodeURIComponent(page.pagination.nextCursor)}`;

        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: `${pathname}?${search}`,
                    children: [{type: "text", value: agentWebInboxPageNextPageLinkText}],
                },
            ],
        });
    }

    if (page.isEndOfEntries) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: agentWebInboxPageEndOfEntriesText(page.status)}],
        });
    }

    return {type: "root", children};
}

/**
 * The preamble names the `?status` filter, links to the account whose inbox this
 * is, and links to a toggle for the other filter (e.g. "See done notifications").
 * The account link lets `parse` recover `page.account` (the API doesn't echo it
 * back), and the phrasing tells the agent which filter is active.
 */
async function printAgentWebInboxPagePreambleParagraph(
    storage: AgentWebSessionStorage,
    account: ApiAccountReferenceResponse,
    status: AgentWebInboxPageStatus,
): Promise<Paragraph> {
    const [accountPathname, inboxPathname] = await runAllPromises([
        createAgentWebPageLinkPathname(storage, account),
        createAgentWebPageLinkPathname(storage, {type: "Inbox", account}),
    ]);

    // The toggle links to the other filter. `New` is the default, so its link omits
    // the `?status` search param.
    const toggleUrl = status === "Done" ? inboxPathname : `${inboxPathname}?status=done`;
    const toggleText = status === "Done" ? "See new notifications" : "See done notifications";

    return {
        type: "paragraph",
        children: [
            {type: "text", value: agentWebInboxPagePreambleLead(status)},
            {type: "link", url: accountPathname, children: [{type: "text", value: account.title}]},
            {type: "text", value: ". ("},
            {type: "link", url: toggleUrl, children: [{type: "text", value: toggleText}]},
            {type: "text", value: ")"},
        ],
    };
}

function agentWebInboxPagePreambleLead(status: AgentWebInboxPageStatus): string {
    switch (status) {
        case "New":
            return "Showing new notifications for ";
        case "Done":
            return "Showing done notifications for ";
        default:
            throw exhaustive(status);
    }
}

/**
 * Prints one entry as a list item: a title line (an optional `<badge>` for loud
 * notifications, the linked title, and the time in parentheses) optionally
 * followed by an `Author: preview` paragraph. Private/deleted entities have no
 * link, so their title is printed as plain text.
 */
async function printAgentWebInboxPageEntryListItem(
    storage: AgentWebSessionStorage,
    entry: AgentWebInboxPageEntry,
): Promise<ListItem> {
    const titleLine: Array<PhrasingContent> = [];

    if (entry.loudNotificationCount > 0) {
        titleLine.push(
            {type: "html", value: "<badge>"},
            {type: "text", value: `${entry.loudNotificationCount}`},
            {type: "html", value: "</badge>"},
            {type: "text", value: " "},
        );
    }

    if (entry.link === null) {
        titleLine.push({type: "text", value: entry.title});
    } else {
        titleLine.push({
            type: "link",
            url: await createAgentWebPageLinkPathname(storage, entry.link),
            children: [{type: "text", value: entry.title}],
        });
    }

    titleLine.push({type: "text", value: ` (${entry.timeAttribute})`});

    const children: Array<Paragraph> = [{type: "paragraph", children: titleLine}];

    if (entry.preview !== null) {
        children.push(printAgentWebInboxPageEntryPreviewParagraph(entry.preview));
    }

    return {type: "listItem", spread: entry.preview !== null, children};
}

/**
 * Prints the preview snippet.
 */
function printAgentWebInboxPageEntryPreviewParagraph(preview: string): Paragraph {
    return {
        type: "paragraph",
        children: [{type: "text", value: preview}],
    };
}

/**
 * Parses an inbox page from an mdast tree. Mirrors
 * `parseAgentWebTaskCollectionPage`.
 *
 * The `?status` filter is recovered from the preamble, entries from the list, the
 * `?after` cursor from the "Next page" link, and end-of-inbox from its marker.
 * `id` is unused — it's `null` only if the inbox is ever parsed outside the
 * context of a specific account.
 */
export async function parseAgentWebInboxPage(
    storage: AgentWebSessionStorage,
    id: AccountId | null,
    root: Root,
): Promise<AgentWebInboxPage> {
    let account: ApiAccountReferenceResponse | null = null;
    let status: AgentWebInboxPageStatus = "New";
    let entries: ReadonlyArray<AgentWebInboxPageEntry> = [];
    let pagination: AgentWebInboxPagePagination | null = null;
    let isEndOfEntries = false;
    let sawList = false;

    for (let index = 0; index < root.children.length; index++) {
        const child = root.children[index]!;

        if (isEndOfEntries) {
            throw new InvalidArgumentError("Content after end of inbox marker", {
                displayMessage: errorDisplayMessage`Unexpected markdown on line ${child.position?.start.line ?? "unknown"} after the end-of-notifications marker. It must be the last thing on the page. Try again without adding anything after it.`,
            });
        }

        // The status/account preamble is always the first block.
        if (index === 0) {
            ({status, account} = await parseAgentWebInboxPagePreamble(storage, child));
            continue;
        }

        if (isAgentWebInboxPageEndOfEntriesParagraph(child)) {
            isEndOfEntries = true;
            continue;
        }

        const nextPageLink = getAgentWebInboxPageNextPageLinkIfPossible(child);
        if (nextPageLink !== null && pagination === null) {
            pagination = await parseAgentWebInboxPageNextPageLink(storage, nextPageLink);
            continue;
        }

        if (child.type === "list" && !child.ordered && !sawList) {
            sawList = true;
            entries = await runAllPromises(
                child.children.map(listItem => parseAgentWebInboxPageEntry(storage, listItem)),
            );
            continue;
        }

        throw new InvalidArgumentError("Unexpected markdown in inbox page", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${child.position?.start.line ?? "unknown"} in the inbox. Try again with a list of notifications, an optional \u201C${agentWebInboxPageNextPageLinkText}\u201D link, and an optional \u201CEnd of new notifications.\u201D marker.`,
        });
    }

    if (account === null) {
        throw new InvalidArgumentError("Missing inbox preamble", {
            displayMessage: errorDisplayMessage`The inbox is empty. Try again with the \`read\` tool to get a fresh inbox page.`,
        });
    }

    return {type: "Inbox", account, status, pagination, entries, isEndOfEntries};
}

async function parseAgentWebInboxPagePreamble(
    storage: AgentWebSessionStorage,
    node: RootContent,
): Promise<{status: AgentWebInboxPageStatus; account: ApiAccountReferenceResponse}> {
    if (node.type === "paragraph") {
        const text = printMarkdownPhrasingContentText(node.children);
        const statusMatch = text.match(/showing (new|done) notifications/i);
        const link = node.children.find((child): child is Link => child.type === "link") ?? null;

        if (statusMatch !== null && link !== null) {
            const routeResult = await routeAgentWebPageLinkPathname(storage, link.url);

            if (routeResult !== null && routeResult.pageLink.type === "Account") {
                return {
                    status: statusMatch[1]!.toLowerCase() === "done" ? "Done" : "New",
                    account: routeResult.pageLink,
                };
            }
        }
    }

    throw new InvalidArgumentError("Missing inbox status preamble", {
        displayMessage: errorDisplayMessage`The inbox must start with a line like \u201CShowing new notifications for [name](/human/name).\u201D on line ${node.position?.start.line ?? "unknown"}. Try again with the \`read\` tool to get a fresh inbox page.`,
    });
}

function isAgentWebInboxPageEndOfEntriesParagraph(node: RootContent): boolean {
    return (
        node.type === "paragraph" &&
        agentWebInboxPageEndOfEntriesRegExp.test(
            printMarkdownPhrasingContentText(node.children).trim(),
        )
    );
}

function getAgentWebInboxPageNextPageLinkIfPossible(node: RootContent): Link | null {
    if (node.type !== "paragraph") return null;
    if (node.children.length !== 1) return null;

    const child = node.children[0]!;
    if (child.type !== "link") return null;
    if (printMarkdownPhrasingContentText(child.children) !== agentWebInboxPageNextPageLinkText) {
        return null;
    }

    return child;
}

async function parseAgentWebInboxPageNextPageLink(
    storage: AgentWebSessionStorage,
    link: Link,
): Promise<AgentWebInboxPagePagination> {
    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const afterCursor = searchParams.get("after");
    const result = await routeAgentWebPageLinkPathname(storage, pathname);

    if (result === null || result.pageLink.type !== "Inbox" || afterCursor === null) {
        throw new InvalidArgumentError("Invalid inbox next page link", {
            displayMessage: errorDisplayMessage`Couldn\u2019t interpret the \u201C${agentWebInboxPageNextPageLinkText}\u201D link on line ${link.position?.start.line ?? "unknown"}. Try again with a \u201C${agentWebInboxPageNextPageLinkText}\u201D link you\u2019ve seen from a \`read\` of an inbox.`,
        });
    }

    return {nextCursor: afterCursor};
}

async function parseAgentWebInboxPageEntry(
    storage: AgentWebSessionStorage,
    listItem: ListItem,
): Promise<AgentWebInboxPageEntry> {
    const createError = () =>
        new InvalidArgumentError("Invalid inbox entry list item", {
            displayMessage: errorDisplayMessage`Unexpected markdown in the inbox notification on line ${listItem.position?.start.line ?? "unknown"}. Try again with a single notification (e.g. \`- [Caleb sent you a message](/chat-message/caleb-hey) (May 14th at 10:55am EDT)\`) optionally followed by an \`Author: preview\` line.`,
        });

    const titleParagraph = listItem.children[0];
    if (titleParagraph?.type !== "paragraph") throw createError();

    const previewParagraph = listItem.children[1];
    if (previewParagraph !== undefined && previewParagraph.type !== "paragraph")
        throw createError();
    if (listItem.children.length > 2) throw createError();

    const {loudNotificationCount, link, title, timeAttribute} =
        parseAgentWebInboxPageEntryTitleLine(titleParagraph, createError);

    let pageLink: AgentWebPageLink | null = null;

    if (link !== null) {
        const routeResult = await routeAgentWebPageLinkPathname(storage, link.url);

        if (routeResult === null) {
            throw new InvalidArgumentError("Unknown inbox entry link", {
                displayMessage: errorDisplayMessage`Couldn\u2019t find the notification target for the link on line ${link.position?.start.line ?? "unknown"}. Try again with a notification link you\u2019ve seen from a \`read\` of an inbox.`,
            });
        }

        pageLink = routeResult.pageLink;
    }

    const preview =
        previewParagraph !== undefined
            ? printMarkdownPhrasingContentText(previewParagraph.children).trim()
            : null;

    return {link: pageLink, title, preview, timeAttribute, loudNotificationCount};
}

/**
 * Parses an entry's title line: an optional leading `<badge>N</badge>`, the linked
 * (or plain-text) title, and the trailing ` (time)`. The title comes from the link
 * text when present, otherwise the plain text before the time.
 */
function parseAgentWebInboxPageEntryTitleLine(
    paragraph: Paragraph,
    createError: () => InvalidArgumentError,
): {loudNotificationCount: number; link: Link | null; title: string; timeAttribute: string} {
    let nodes: ReadonlyArray<PhrasingContent> = paragraph.children;
    let loudNotificationCount = 0;

    // An optional loud-notification badge prints as three inline nodes: `<badge>`
    // (html), the count (text), and `</badge>` (html).
    if (
        nodes[0]?.type === "html" &&
        nodes[0].value === "<badge>" &&
        nodes[1]?.type === "text" &&
        nodes[2]?.type === "html" &&
        nodes[2].value === "</badge>"
    ) {
        const count = parseInt(nodes[1].value.trim(), 10);
        if (Number.isNaN(count)) throw createError();
        loudNotificationCount = count;
        nodes = nodes.slice(3);
    }

    const link = nodes.find((node): node is Link => node.type === "link") ?? null;

    // Everything else must be plain text (whitespace and the trailing ` (time)`).
    for (const node of nodes) {
        if (node.type === "text") continue;
        if (node === link) continue;
        throw createError();
    }

    const text = printMarkdownPhrasingContentText(nodes).trim();
    const timeMatch = text.match(/^(.*?)\s*\(([^()]*)\)$/s);
    if (timeMatch === null) throw createError();

    const timeAttribute = timeMatch[2]!.trim();
    if (timeAttribute.length === 0) throw createError();

    const title =
        link !== null
            ? printMarkdownPhrasingContentText(link.children).trim()
            : timeMatch[1]!.trim();
    if (title.length === 0) throw createError();

    return {loudNotificationCount, link, title, timeAttribute};
}
