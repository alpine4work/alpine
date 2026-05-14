import {
    AgentWebMessagingPageBase,
    agentWebMessagingPageMessageNouns,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {runAgentWebPageTests} from "~/server/agents/web/pages/run_agent_web_page_tests.js";
import {
    ApiContentInlineElement,
    ApiContentInlineElementMark,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

const apostrophe = String.fromCharCode(39);
const doubleQuote = String.fromCharCode(34);

function content(elements: ApiContentResponse["elements"]): ApiContentResponse {
    return {elements};
}

function paragraph(elements: ReadonlyArray<ApiContentInlineElement>) {
    return {type: "Paragraph" as const, elements};
}

function text(text: string, marks?: ReadonlyArray<ApiContentInlineElementMark>) {
    return {type: "Text" as const, text, marks};
}

runAgentWebPageTests<null, AgentWebMessagingPageBase>({
    print: printAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    parse: parseAgentWebMessagingPageBase.bind(null, agentWebMessagingPageMessageNouns),
    tests: [
        {
            name: "simple message log",
            pageLink: null,
            markdown: `\
<time>May 13, 2026 3:00 PM EDT</time>

<human name="Alice">

Hello there.

</human>
`,
            page: {
                blocks: [
                    {
                        type: "Time",
                        timeContent: "May 13, 2026 3:00 PM EDT",
                    },
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Hello there.")])]),
                    },
                ],
            },
        },
        {
            name: "bot message with reply preview and rich content",
            pageLink: null,
            markdown: `\
<bot name="Assistant" time="12 minutes later">

<blockquote cite="Alice">

Can you review **this**?

</blockquote>

## Plan

Review **now** and *carefully*.

\`\`\`javascript
const done = true;
\`\`\`

</bot>
`,
            page: {
                blocks: [
                    {
                        type: "Message",
                        tagName: "bot",
                        nameAttribute: "Assistant",
                        timeAttribute: "12 minutes later",
                        timeZoneAttribute: null,
                        parent: {
                            nameAttribute: "Alice",
                            previewContent: content([
                                paragraph([
                                    text("Can you review "),
                                    text("this", [{type: "Bold"}]),
                                    text("?"),
                                ]),
                            ]),
                        },
                        content: content([
                            {
                                type: "Heading",
                                level: 1,
                                elements: [text("Plan")],
                            },
                            paragraph([
                                text("Review "),
                                text("now", [{type: "Bold"}]),
                                text(" and "),
                                text("carefully", [{type: "Italic"}]),
                                text("."),
                            ]),
                            {
                                type: "Code",
                                language: "javascript",
                                lines: [
                                    {
                                        elements: [text("const done = true;")],
                                    },
                                ],
                            },
                        ]),
                    },
                ],
            },
        },
        {
            name: "escaped messaging html",
            pageLink: null,
            markdown: `\
<time>May &amp; &quot;Later&quot; &lt;soon&gt;</time>

<human name="Alice &amp; Bob&#39;s &quot;Team&quot;" time="5 &lt; 10 &amp; &quot;later&quot;" timezone="GMT+0 &amp; east">

<blockquote cite="Carol &amp; Dan&#39;s &quot;Team&quot;">

Quoted reply.

</blockquote>

Escaped attributes survive.

</human>
`,
            page: {
                blocks: [
                    {
                        type: "Time",
                        timeContent: `May & ${doubleQuote}Later${doubleQuote} <soon>`,
                    },
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: `Alice & Bob${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
                        timeAttribute: `5 < 10 & ${doubleQuote}later${doubleQuote}`,
                        timeZoneAttribute: "GMT+0 & east",
                        parent: {
                            nameAttribute: `Carol & Dan${apostrophe}s ${doubleQuote}Team${doubleQuote}`,
                            previewContent: content([paragraph([text("Quoted reply.")])]),
                        },
                        content: content([paragraph([text("Escaped attributes survive.")])]),
                    },
                ],
            },
        },
        {
            name: "message content with html blocks",
            pageLink: null,
            markdown: `\
<human name="Alice">

<hr/>

<p></p>

After the empty paragraph.

</human>
`,
            page: {
                blocks: [
                    {
                        type: "Message",
                        tagName: "human",
                        nameAttribute: "Alice",
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([
                            {type: "Divider"},
                            paragraph([]),
                            paragraph([text("After the empty paragraph.")]),
                        ]),
                    },
                ],
            },
        },
        {
            name: "content outside message",
            pageLink: null,
            markdown: `\
Hello outside.
`,
            parseError:
                "Messages must be wrapped in `<human>` or `<bot>` tags. Move this content into a message or remove it.",
        },
        {
            name: "message without name attribute",
            pageLink: null,
            markdown: `\
<human>

Hello.

</human>
`,
            parseError:
                'The `<human>` tag is missing the required `name` attribute. Add `name="..."` to the tag.',
        },
        {
            name: "unclosed message",
            pageLink: null,
            markdown: `\
<bot name="Assistant">

Hello.
`,
            parseError:
                "Messages must close their `<bot>` tag. Add `</bot>` at the end of the message.",
        },
        {
            name: "blockquote outside message",
            pageLink: null,
            markdown: `\
<blockquote cite="Alice">

Hello.

</blockquote>
`,
            parseError:
                "Reply previews must be inside a `<human>` or `<bot>` message. Move the `<blockquote>` into a message or remove it.",
        },
    ],
});
