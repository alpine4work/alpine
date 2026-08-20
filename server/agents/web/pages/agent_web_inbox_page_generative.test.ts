import fc, {Arbitrary} from "fast-check";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.open_source.js";
import {printAgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.open_source.js";
import {
    AgentWebInboxPage,
    AgentWebInboxPageEntry,
    AgentWebInboxPagePagination,
    AgentWebInboxPageStatus,
    normalizeAgentWebInboxPage,
    parseAgentWebInboxPage,
    printAgentWebInboxPage,
} from "~/server/agents/web/pages/agent_web_inbox_page.open_source.js";
import {runAgentWebPageGenerativeTests} from "~/server/agents/web/test_helpers/run_agent_web_page_generative_tests.js";
import {
    ApiChannelReferenceArbitrary,
    ApiContentTextArbitrary,
    ApiDocumentReferenceArbitrary,
    createIdArbitrary,
} from "~/shared/api/content/test_helpers/api_content_arbitrary.js";
import {ApiAccountReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

// The inbox is addressed by a single human `AccountId`, and
// `printAgentWebInboxPage` asserts the page link equals `page.account.id`. Share
// one fixed id between the page link and the page's account so the two always
// agree. The account id isn't printed (the account round-trips through its
// `/human/{name}` link), so a constant costs no coverage.
const inboxAccountId = generateId<AccountId>();

// Text that survives the print/parse round-trip: parsing trims titles/previews and
// rejects empty ones, so we trim up front and drop anything that trims to empty.
const AgentWebInboxPageTextArbitrary: Arbitrary<string> = ApiContentTextArbitrary.map(text =>
    text.trim(),
).filter(text => text.length > 0);

// The time attribute is printed inside `(…)` and parsed back out of the matching
// `[^()]*`, so it additionally can't contain parentheses. Strip them (rather than
// filter) to keep the generation rate high.
const AgentWebInboxPageTimeAttributeArbitrary: Arbitrary<string> = ApiContentTextArbitrary.map(
    text => text.replace(/[()]/g, "").trim(),
).filter(text => text.length > 0);

// The inbox links to the content each notification is about. Message notifications
// deep-link to a specific message; the rest link to the parent entity. Hydrated
// link fields (titles, authors, previews) round-trip verbatim through session
// storage, so they're left unconstrained. Each record is annotated with its stored
// link member type so `fc.constant(...)` infers the literal `type`.
const AgentWebInboxPageChatMessageLinkArbitrary: Arbitrary<
    Extract<AgentWebPageStoredLink, {type: "ChatMessage"}>
> = fc.record({
    type: fc.constant("ChatMessage"),
    id: createIdArbitrary<ChatId>(),
    index: fc.nat({max: 100}),
    authorShortName: ApiContentTextArbitrary,
    preview: ApiContentTextArbitrary,
});

const AgentWebInboxPagePostMessageLinkArbitrary: Arbitrary<
    Extract<AgentWebPageStoredLink, {type: "PostMessage"}>
> = fc.record({
    type: fc.constant("PostMessage"),
    id: createIdArbitrary<PostId>(),
    index: fc.nat({max: 100}),
    authorShortName: ApiContentTextArbitrary,
    preview: ApiContentTextArbitrary,
});

const AgentWebInboxPageDocumentMessageLinkArbitrary: Arbitrary<
    Extract<AgentWebPageStoredLink, {type: "DocumentMessage"}>
> = fc.record({
    type: fc.constant("DocumentMessage"),
    document: fc.record({
        type: fc.constant("Document"),
        id: createIdArbitrary<DocumentId>(),
    }),
    id: createIdArbitrary<DocumentCommentThreadId>(),
    index: fc.nat({max: 100}),
    authorShortName: ApiContentTextArbitrary,
    preview: ApiContentTextArbitrary,
});

const AgentWebInboxPageTaskMessageLinkArbitrary: Arbitrary<
    Extract<AgentWebPageStoredLink, {type: "TaskMessage"}>
> = fc.record({
    type: fc.constant("TaskMessage"),
    id: createIdArbitrary<TaskId>(),
    index: fc.nat({max: 100}),
    authorShortName: ApiContentTextArbitrary,
    preview: ApiContentTextArbitrary,
});

const AgentWebInboxPagePostLinkArbitrary: Arbitrary<
    Extract<AgentWebPageStoredLink, {type: "Post"}>
> = fc.record({
    type: fc.constant("Post"),
    id: createIdArbitrary<PostId>(),
    title: ApiContentTextArbitrary,
});

const AgentWebInboxPageEntryLinkArbitrary = fc.oneof(
    AgentWebInboxPageChatMessageLinkArbitrary,
    AgentWebInboxPagePostMessageLinkArbitrary,
    AgentWebInboxPageDocumentMessageLinkArbitrary,
    AgentWebInboxPageTaskMessageLinkArbitrary,
    AgentWebInboxPagePostLinkArbitrary,
    ApiChannelReferenceArbitrary,
    ApiDocumentReferenceArbitrary,
    // Every generated link is a stored link, so it's safe to widen to the general
    // `AgentWebPageLink` the entry expects.
) as Arbitrary<AgentWebPageLink>;

const AgentWebInboxPageEntryArbitrary: Arbitrary<AgentWebInboxPageEntry> = fc.record({
    // Most entries link somewhere; a private/deleted entity has no link and renders
    // its title as plain text.
    link: fc.oneof(
        {weight: 6, arbitrary: AgentWebInboxPageEntryLinkArbitrary},
        {weight: 1, arbitrary: fc.constant(null)},
    ),
    title: AgentWebInboxPageTextArbitrary,
    preview: fc.oneof(
        {weight: 3, arbitrary: AgentWebInboxPageTextArbitrary},
        {weight: 1, arbitrary: fc.constant(null)},
    ),
    timeAttribute: AgentWebInboxPageTimeAttributeArbitrary,
    // A count of 0 prints no `<badge>`; a positive count prints one.
    loudNotificationCount: fc.oneof(
        {weight: 2, arbitrary: fc.constant(0)},
        {weight: 3, arbitrary: fc.integer({min: 1, max: 99})},
    ),
});

const AgentWebInboxPageEntriesArbitrary: Arbitrary<ReadonlyArray<AgentWebInboxPageEntry>> = fc
    .array(AgentWebInboxPageEntryArbitrary)
    .map(entries => {
        // Two entries whose links share a stored link key (e.g. the same message index in
        // the same chat, or the same channel) would collide in session storage: the later
        // pathname wins the key, so the earlier entry's link would resolve to the later
        // link and break the round-trip. Keep only the first entry per link key. Entries
        // without a link never touch storage and so can't collide.
        const seenLinkKeys = new Set<string>();
        return entries.filter(entry => {
            if (entry.link === null) return true;
            const key = printAgentWebPageStoredLinkKey(entry.link as AgentWebPageStoredLink);
            if (seenLinkKeys.has(key)) return false;
            seenLinkKeys.add(key);
            return true;
        });
    });

// The inbox is always a human's (bots have no inbox, and the `/human/{name}/inbox`
// routed link asserts a `/human/` pathname), so never a bot.
const AgentWebInboxPageAccountArbitrary: Arbitrary<ApiAccountReference> = fc.record({
    type: fc.constant("Account"),
    id: fc.constant(inboxAccountId),
    title: ApiContentTextArbitrary,
    shortName: ApiContentTextArbitrary,
});

const AgentWebInboxPageStatusArbitrary: Arbitrary<AgentWebInboxPageStatus> = fc.constantFrom(
    "New",
    "Done",
);

const AgentWebInboxPagePaginationArbitrary: Arbitrary<AgentWebInboxPagePagination> = fc.record({
    // The opaque resume cursor round-trips through `encodeURIComponent` and the URL
    // search params, so any nonempty string is fine.
    nextCursor: ApiContentTextArbitrary.filter(text => text.length > 0),
});

const AgentWebInboxPageArbitrary: Arbitrary<AgentWebInboxPage> = fc.record({
    type: fc.constant("Inbox"),
    account: AgentWebInboxPageAccountArbitrary,
    status: AgentWebInboxPageStatusArbitrary,
    pagination: fc.oneof(
        {weight: 3, arbitrary: fc.constant(null)},
        {weight: 1, arbitrary: AgentWebInboxPagePaginationArbitrary},
    ),
    entries: AgentWebInboxPageEntriesArbitrary,
    isEndOfEntries: fc.boolean(),
});

runAgentWebPageGenerativeTests({
    print: printAgentWebInboxPage,
    parse: parseAgentWebInboxPage,
    normalize: normalizeAgentWebInboxPage,
    pageLink: fc.constant(inboxAccountId),
    page: AgentWebInboxPageArbitrary,
});
