import {Root} from "mdast";
import {AgentWebPageDocumentThreadRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
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

function text(text: string): ApiContentTextInlineElement {
    return {type: "Text", text};
}

async function seedDocumentThreadStorage(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageDocumentThreadRoutedLink,
): Promise<void> {
    await createAgentWebPageStoredLinkPathname(storage, pageLink.document);
    await storage.documentCommentThreadNumberById.put(
        `${pageLink.document.id}-${pageLink.threadId}`,
        1,
    );
    await storage.documentCommentThreadIdByNumber.put(
        `${pageLink.document.id}-1`,
        pageLink.threadId,
    );
}

async function printAgentWebDocumentThreadPageForTest(
    storage: AgentWebSessionStorage,
    pageLink: AgentWebPageDocumentThreadRoutedLink,
    page: AgentWebDocumentThreadPage,
): Promise<Root> {
    await seedDocumentThreadStorage(storage, pageLink);
    return await printAgentWebDocumentThreadPage(storage, pageLink, page);
}

const previewBlock: AgentWebDocumentThreadPageCustomBlock = {
    type: "Custom",
    tagName: "document-preview",
    timeAttribute: null,
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

runAgentWebPageTests<AgentWebPageDocumentThreadRoutedLink, AgentWebDocumentThreadPage>({
    print: printAgentWebDocumentThreadPageForTest,
    parse: parseAgentWebDocumentThreadPage,
    normalize: normalizeAgentWebDocumentThreadPage,
    tests: [
        {
            name: "document thread preview and comments",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<document-preview>

Please review this section today.

</document-preview>

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
                    document: documentReference,
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
            createParseError: "NOCOMMIT",
        },
        {
            name: "legacy document thread preamble",
            pageLink,
            markdown: `\
Document thread on [Launch Spec](/document/launch-spec).

<document-preview>

Preview body.

</document-preview>
`,
            printMarkdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<document-preview>

Preview body.

</document-preview>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    document: documentReference,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [previewBlock],
            },
            createParseError: "NOCOMMIT",
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
            createParseError: "NOCOMMIT",
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
                    document: documentReference,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [firstCommentBlock],
            },
            createParseError: "NOCOMMIT",
        },
        {
            name: "document thread page with custom pagination links",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec). [« Previous page](/document/launch-spec/comments/1?before=document-preview) | [Next page »](/document/launch-spec/comments/1?after=document-preview)

<document-preview>

Preview body.

</document-preview>

<time>May 14th at 10:55am EDT</time>

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    document: documentReference,
                },
                pagination: {
                    pageLink,
                    previousLink: {type: "Custom", beforeTagName: "document-preview"},
                    nextLink: {type: "Custom", afterTagName: "document-preview"},
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
            createParseError: "NOCOMMIT",
        },
        {
            name: "document preview comment mark",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<document-preview>

Please <comment>review this section</comment> today.

</document-preview>
`,
            page: {
                type: "DocumentThread",
                subType: "Head",
                preamble: {
                    document: documentReference,
                },
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Custom",
                        tagName: "document-preview",
                        timeAttribute: null,
                        content: content([
                            paragraph([
                                text("Please "),
                                {
                                    type: "Text",
                                    text: "review this section",
                                    marks: [{type: "Comment", thread: {id: threadId}}],
                                },
                                text(" today."),
                            ]),
                        ]),
                    },
                ],
            },
            createParseError: "NOCOMMIT",
        },
        {
            name: "document preview after comments",
            pageLink,
            markdown: `\
Document comment thread on [Launch Spec](/document/launch-spec).

<comment id="0" from="[Bob](/human/bob)">

First comment.

</comment>

<document-preview>

Preview body.

</document-preview>
`,
            setupStorage: async storage => {
                await seedDocumentThreadStorage(storage, pageLink);
                await createAgentWebPageStoredLinkPathname(storage, bobReference);
            },
            parseError:
                "There must be only one `<document-preview>` immediately after the first line which states what document the thread is on (e.g. `Document thread on [My Document](/document/my-document).`). Try again with one `<document-preview>` at the start of the markdown.",
            createParseError: "NOCOMMIT",
        },
    ],
});
