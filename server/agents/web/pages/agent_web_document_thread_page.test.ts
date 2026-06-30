import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {
    AgentWebDocumentThreadPage,
    AgentWebDocumentThreadPageCustomBlock,
    normalizeAgentWebDocumentThreadPage,
    parseAgentWebDocumentThreadPage,
    printAgentWebDocumentThreadPage,
} from "~/server/agents/web/pages/agent_web_document_thread_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiContentParagraphBlockElementResponseWithoutKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiContentInlineElementResponse,
    ApiContentTextInlineElement,
    ApiDocumentReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

const documentId = generateId<DocumentId>();
const threadId = generateId<DocumentCommentThreadId>();

const documentReference: ApiDocumentReferenceResponse = {
    type: "Document",
    id: documentId,
    title: "Launch Spec",
};

const pageLink: AgentWebPageDocumentThreadRoutedLink = {
    type: "DocumentThread",
    document: documentReference,
    threadId,
};

function accountReference({
    name,
    botId,
}: {
    name: string;
    botId?: BotId;
}): ApiAccountReferenceResponse {
    return {
        type: "Account",
        id: generateId<AccountId>(),
        title: name,
        shortName: name,
        ...(botId ? {bot: {id: botId}} : {}),
    };
}

const aliceReference = accountReference({name: "Alice"});
const bobReference = accountReference({name: "Bob"});

function content(
    elements: ApiContentResponseWithoutKeys["elements"],
): ApiContentResponseWithoutKeys {
    return {elements};
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElementResponse>,
): ApiContentParagraphBlockElementResponseWithoutKeys {
    return {type: "Paragraph", elements};
}

function text(
    text: string,
    marks?: ApiContentTextInlineElement["marks"],
): ApiContentTextInlineElement {
    return marks ? {type: "Text", text, marks} : {type: "Text", text};
}

const previewBlock: AgentWebDocumentThreadPageCustomBlock = {
    type: "Custom",
    tagName: "blockquote",
    timeAttribute: null,
    hasCiteAttribute: false,
    matchAttribute: null,
    content: content([paragraph([text("Preview body.")])]),
};

const firstCommentBlock = {
    type: "Message" as const,
    idAttribute: {startMessageIndex: 0, endMessageIndex: 1},
    author: bobReference,
    timeAttribute: null,
    timeZoneAttribute: null,
    parent: null,
    content: content([paragraph([text("First comment.")])]),
};

runAgentWebPageTests<
    {document: {id: DocumentId}; threadId: DocumentCommentThreadId},
    AgentWebDocumentThreadPage
>({
    print: printAgentWebDocumentThreadPage,
    parse: parseAgentWebDocumentThreadPage,
    normalize: normalizeAgentWebDocumentThreadPage,
    tests: [
        {
            name: "document thread preview and comments",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Please review this section today.

</blockquote>

<time>May 14th at 10:55am EDT</time>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>

End of comments.
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: null,
                isEndOfMessages: true,
                blocks: [
                    {
                        ...previewBlock,
                        content: content([paragraph([text("Please review this section today.")])]),
                    },
                    {
                        type: "Time",
                        timeContent: "May 14th at 10:55am EDT",
                    },
                    firstCommentBlock,
                ],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "legacy document thread preamble",
            pageLink,
            markdown: `\
Document thread on [Launch Spec](/document/launch-spec).

<blockquote>

Preview body.

</blockquote>
`,
            printMarkdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Preview body.

</blockquote>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [previewBlock],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "document thread quote cite and match attributes",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote cite="../.." match="2">

Preview body.

</blockquote>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        ...previewBlock,
                        hasCiteAttribute: true,
                        matchAttribute: 2,
                    },
                ],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "document thread quote with invalid match attribute",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote match="second">

Preview body.

</blockquote>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
                await storage.documentCommentThreadNumberById.put(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                    1,
                );
                await storage.documentCommentThreadIdByNumber.put(
                    `${pageLink.document.id}-1`,
                    pageLink.threadId,
                );
            },
            parseError:
                'Invalid `<blockquote>` `match` attribute on line 5. Try again with a 1-indexed integer like `match="2"`.',
            createParseError:
                'Invalid `<blockquote>` `match` attribute on line 5. Try again with a 1-indexed integer like `match="2"`.',
        },
        {
            name: "document thread quote with invalid cite attribute",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote cite="/document/launch-spec">

Preview body.

</blockquote>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
                await storage.documentCommentThreadNumberById.put(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                    1,
                );
                await storage.documentCommentThreadIdByNumber.put(
                    `${pageLink.document.id}-1`,
                    pageLink.threadId,
                );
            },
            parseError:
                'Invalid `<blockquote>` `cite` attribute on line 5. The `<blockquote>` `cite` attribute must always be `cite="../.."` since we always want to quote content from the parent document. Try again with `cite="../.."` or omit the `cite` attribute entirely (`cite="../.."` is implied).',
            createParseError:
                'Invalid `<blockquote>` `cite` attribute on line 5. The `<blockquote>` `cite` attribute must always be `cite="../.."` since we always want to quote content from the parent document. Try again with `cite="../.."` or omit the `cite` attribute entirely (`cite="../.."` is implied).',
        },
        {
            name: "resolved document thread state uses checkbox",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Unresolved

<blockquote>

Preview body.

</blockquote>
`,
            printMarkdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Resolved

<blockquote>

Preview body.

</blockquote>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: true,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [previewBlock],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "unresolved document thread state uses checkbox",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Resolved

<blockquote>

Preview body.

</blockquote>
`,
            printMarkdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Preview body.

</blockquote>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [previewBlock],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "comments-only document thread page with pagination",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec). [Next page »](/document/launch-spec/comments/1?after=1)

<comment id="0-1" from="[Alice](/human/alice)">

First comment.

Second comment.

</comment>
`,
            page: {
                type: "DocumentThread",
                subType: "Tail",
                preamble: {
                    type: "Tail",
                    document: documentReference,
                },
                pagination: {
                    pageLink,
                    previousLink: null,
                    nextLink: {type: "Message", afterMessageIndex: 1},
                },
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: {startMessageIndex: 0, endMessageIndex: 2},
                        author: aliceReference,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            paragraph([text("First comment.")]),
                            paragraph([text("Second comment.")]),
                        ]),
                    },
                ],
            },
            createParseError:
                "Can\u2019t add \u201cNext page \u00bb\u201d link when creating comments markdown. Try again without the \u201cNext page \u00bb\u201d link.",
        },
        {
            name: "comments-only document thread page without pagination",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            page: {
                type: "DocumentThread",
                subType: "Tail",
                preamble: {
                    type: "Tail",
                    document: documentReference,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [firstCommentBlock],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "unresolved state on comments-only document thread page",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
                await storage.documentCommentThreadNumberById.put(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                    1,
                );
                await storage.documentCommentThreadIdByNumber.put(
                    `${pageLink.document.id}-1`,
                    pageLink.threadId,
                );
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "`- [ ] Unresolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [ ] Unresolved`.",
            createParseError:
                "`- [ ] Unresolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [ ] Unresolved`.",
        },
        {
            name: "resolved state on comments-only document thread page",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [x] Resolved

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
                await storage.documentCommentThreadNumberById.put(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                    1,
                );
                await storage.documentCommentThreadIdByNumber.put(
                    `${pageLink.document.id}-1`,
                    pageLink.threadId,
                );
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "`- [x] Resolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [x] Resolved`.",
            createParseError:
                "`- [x] Resolved` can only be included on the first page of a document comment thread, right before a `<blockquote>`. Try again and remove `- [x] Resolved`.",
        },
        {
            name: "document thread page with custom pagination links",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec). [« Previous page](/document/launch-spec/comments/1?before=blockquote) | [Next page »](/document/launch-spec/comments/1?after=blockquote)

<blockquote>

Preview body.

</blockquote>

<time>May 14th at 10:55am EDT</time>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            printMarkdown: `\
Document comment thread on [Launch Spec](/document/launch-spec). [« Previous page](/document/launch-spec/comments/1?before=blockquote) | [Next page »](/document/launch-spec/comments/1?after=blockquote)

- [ ] Unresolved

<blockquote>

Preview body.

</blockquote>

<time>May 14th at 10:55am EDT</time>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: {
                    pageLink,
                    previousLink: {type: "Custom", beforeTagName: "blockquote"},
                    nextLink: {type: "Custom", afterTagName: "blockquote"},
                },
                isEndOfMessages: false,
                blocks: [
                    previewBlock,
                    {
                        type: "Time",
                        timeContent: "May 14th at 10:55am EDT",
                    },
                    firstCommentBlock,
                ],
            },
            createParseError:
                "Can\u2019t add \u201cNext page \u00bb\u201d link when creating comments markdown. Try again without the \u201cNext page \u00bb\u201d link.",
        },
        {
            name: "document thread quote formatting",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

- [ ] Unresolved

<blockquote>

Please **review this section** *today*.

</blockquote>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    type: "Head",
                    document: documentReference,
                    isResolved: false,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "blockquote",
                        timeAttribute: null,
                        hasCiteAttribute: false,
                        matchAttribute: null,
                        content: content([
                            paragraph([
                                text("Please "),
                                text("review this section", [{type: "Bold"}]),
                                text(" "),
                                text("today", [{type: "Italic"}]),
                                text("."),
                            ]),
                        ]),
                    },
                ],
            },
            createParseError:
                "Document comment thread markdown must start with `Document comment thread on [My Document](/document/my-document).`. Optionally followed by `- [ ] Unresolved` or `- [x] Resolved`. Try again with a proper start to document comment thread markdown on line 1.",
        },
        {
            name: "document preview after comments",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>

<blockquote>

Preview body.

</blockquote>
`,
            setupStorage: async storage => {
                await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
                await storage.documentCommentThreadNumberById.put(
                    `${pageLink.document.id}-${pageLink.threadId}`,
                    1,
                );
                await storage.documentCommentThreadIdByNumber.put(
                    `${pageLink.document.id}-1`,
                    pageLink.threadId,
                );
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "There must be only one `<blockquote>` and it must be placed immediately after the first line " +
                "which states what document the thread is on (e.g. `Document thread on " +
                "[My Document](/document/my-document).`). Try again with one `<blockquote>` " +
                "at the start of the markdown.",
            createParseError:
                "There must be only one `<blockquote>` and it must be placed immediately after the first line " +
                "which states what document the thread is on (e.g. `Document thread on " +
                "[My Document](/document/my-document).`). Try again with one `<blockquote>` " +
                "at the start of the markdown.",
        },
    ],
});
