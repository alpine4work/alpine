import {
    AgentWebTaskMessageListPage,
    normalizeAgentWebTaskMessageListPage,
    parseAgentWebTaskMessageListPage,
    printAgentWebTaskMessageListPage,
} from "~/server/agents/web/pages/agent_web_task_message_list_page.open_source.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReference,
    ApiContentInlineElement,
    ApiContentParagraphBlockElementWithoutKeys,
    ApiContentTextInlineElement,
    ApiContentWithoutKeys,
    ApiTaskReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.open_source.js";

const taskId = generateId<TaskId>();

function accountReference({name}: {name: string}): ApiAccountReference {
    return {
        type: "Account",
        id: generateId<AccountId>(),
        title: name,
        shortName: name,
    };
}

const taskReference: ApiTaskReference = {
    type: "Task",
    id: taskId,
    title: "Write Spec",
    status: {type: "Open", isActive: true},
};

const aliceReference = accountReference({name: "Alice"});

function content(elements: ApiContentWithoutKeys["elements"]): ApiContentWithoutKeys {
    return {elements};
}

function paragraph(
    elements: ReadonlyArray<ApiContentInlineElement>,
): ApiContentParagraphBlockElementWithoutKeys {
    return {type: "Paragraph", elements};
}

function text(text: string): ApiContentTextInlineElement {
    return {type: "Text", text};
}

runAgentWebPageTests<TaskId, AgentWebTaskMessageListPage>({
    print: printAgentWebTaskMessageListPage,
    parse: parseAgentWebTaskMessageListPage,
    normalize: normalizeAgentWebTaskMessageListPage,
    tests: [
        {
            name: "task comments",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec).
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "task comments without period",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec)
`,
            printMarkdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec).
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: null,
                isEndOfMessages: false,
                blocks: [],
            },
        },
        {
            name: "task comments preamble before comment",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec).

<comment from="[Alice](/human/alice)">

Looks good.

</comment>
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: null,
                isEndOfMessages: false,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
                        deletedAttribute: null,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Looks good.")])]),
                    },
                ],
            },
        },
        {
            name: "task comments end of comments",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec).

<comment from="[Alice](/human/alice)">

Looks good.

</comment>

End of comments.
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: null,
                isEndOfMessages: true,
                blocks: [
                    {
                        type: "Message",
                        idAttribute: null,
                        author: aliceReference,
                        deletedAttribute: null,
                        timeAttribute: null,
                        timeZoneAttribute: null,
                        parent: null,
                        content: content([paragraph([text("Looks good.")])]),
                    },
                ],
            },
        },
        {
            name: "task comments with previous page pagination link",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec). [Previous page »](/task/write-spec/comments?before=3)
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: {
                    pageLink: {type: "TaskMessageList", task: taskReference},
                    previousLink: {type: "Message", beforeMessageIndex: 3},
                    nextLink: null,
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: markdown`
Error: Can\u2019t add \u201CPrevious page »\u201D link when creating comments markdown. Try again
without the \u201CPrevious page »\u201D link.
            `,
        },
        {
            name: "task comments with next page pagination link",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec). [Next page »](/task/write-spec/comments?after=9)
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: {
                    pageLink: {type: "TaskMessageList", task: taskReference},
                    previousLink: null,
                    nextLink: {type: "Message", afterMessageIndex: 9},
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: markdown`
Error: Can\u2019t add \u201CNext page »\u201D link when creating comments markdown. Try again
without the \u201CNext page »\u201D link.
            `,
        },
        {
            name: "task comments with previous and next page pagination links",
            pageLink: taskId,
            markdown: `\
Comments on [Write Spec (Open, active)](/task/write-spec). [« Previous page](/task/write-spec/comments?before=3) | [Next page »](/task/write-spec/comments?after=9)
`,
            page: {
                type: "TaskMessageList",
                preamble: {task: taskReference},
                pagination: {
                    pageLink: {type: "TaskMessageList", task: taskReference},
                    previousLink: {type: "Message", beforeMessageIndex: 3},
                    nextLink: {type: "Message", afterMessageIndex: 9},
                },
                isEndOfMessages: false,
                blocks: [],
            },
            createParseError: markdown`
Error: Can\u2019t add \u201CNext page »\u201D link when creating comments markdown. Try again
without the \u201CNext page »\u201D link.
            `,
        },
        {
            name: "task comments with wrong preamble",
            pageLink: taskId,
            markdown: `\
# Write Spec
`,
            parseError: markdown`
Error: Task comments markdown must start with \u201CComments on\u201D followed by a link to the task
(e.g. \`Comments on [Do thing (Open)](/task/do-thing).\`). Try again with a proper start to task
comments markdown on line 1.
            `,
        },
    ],
});
