import {getClaudeAgentApprovalSummaryContent} from "~/server/agents/bots_v2/sandbox/get_claude_agent_approval_summary_content.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/normalize_agent_web_path.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {DocumentId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";

const storage = createAgentWebSessionStorageForTest("space-1" as SpaceId);

async function putReadResponse(
    storage: AgentWebSessionStorage,
    pathString: string,
    {expirationTime}: {expirationTime: number},
) {
    const {path} = normalizeAgentWebPath(pathString);

    await storage.readResponseByPath.put(path, {
        expirationTime,
        pageMetadata: cast<AgentWebPageMetadata>({
            type: "Document",
            id: "document-1" as DocumentId,
            version: 0,
            keys: [],
        }),
        response: "# Hello World\n",
        newlineIndexes: [13],
    });
}

test("will report a stale read for a path that was never read", async () => {
    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {path: "/document/hello-world", updates: []},
        }),
    ).resolves.toEqual({ok: false});
});

test("will report a stale read for an expired read response", async () => {
    await putReadResponse(storage, "/document/expired", {expirationTime: Date.now() - 1});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__delete",
            input: {path: "/document/expired"},
        }),
    ).resolves.toEqual({ok: false});
});

test("will mention the entity a delete targets", async () => {
    const pathname = await storeAgentWebPageLinkForTest(
        storage,
        cast<ApiMentionReferenceResponse>({
            type: "Task",
            id: "task-1" as TaskId,
            title: "Fix the bug",
            status: {type: "Open", isActive: false},
        }),
    );

    await putReadResponse(storage, pathname, {expirationTime: Date.now() + 60_000});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__delete",
            input: {path: pathname},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [
                {type: "Text", text: "Delete "},
                {
                    type: "Mention",
                    reference: {
                        type: "Task",
                        id: "task-1",
                        title: "Fix the bug",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    });
});

test("will report a stale read for a malformed input", async () => {
    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {updates: []},
        }),
    ).resolves.toEqual({ok: false});
});

test("will mention the entity an update targets", async () => {
    const pathname = await storeAgentWebPageLinkForTest(
        storage,
        cast<ApiMentionReferenceResponse>({
            type: "Document",
            id: "document-1" as DocumentId,
            title: "Hello World",
        }),
    );

    await putReadResponse(storage, pathname, {expirationTime: Date.now() + 60_000});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {path: pathname},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [
                {type: "Text", text: "Update "},
                // The stored link carries the title it was stored with; clients resolve the live
                // title by id.
                {
                    type: "Mention",
                    reference: {type: "Document", id: "document-1", title: "Hello World"},
                },
            ],
        },
    });
});

test("will name what a routed path targets rather than just the entity", async () => {
    const pathname = await storeAgentWebPageLinkForTest(
        storage,
        cast<ApiMentionReferenceResponse>({
            type: "Task",
            id: "task-2" as TaskId,
            title: "Todos",
            status: {type: "Open", isActive: false},
        }),
    );

    const commentsPathname = `${pathname}/comments`;

    await putReadResponse(storage, commentsPathname, {expirationTime: Date.now() + 60_000});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {path: commentsPathname},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [
                {type: "Text", text: "Update comments on "},
                {
                    type: "Mention",
                    reference: {
                        type: "Task",
                        id: "task-2",
                        title: "Todos",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    });
});

test("will link a target that addresses something narrower than the entity", async () => {
    const pathname = await storeAgentWebPageLinkForTest(
        storage,
        cast<ApiMentionReferenceResponse>({
            type: "Task",
            id: "task-3" as TaskId,
            title: "Ship it",
            status: {type: "Open", isActive: false},
        }),
    );

    const subtasksPathname = `${pathname}/subtasks`;

    await putReadResponse(storage, subtasksPathname, {expirationTime: Date.now() + 60_000});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {path: subtasksPathname},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [
                {type: "Text", text: "Update "},
                {
                    type: "Text",
                    text: "subtasks",
                    marks: [{type: "Link", url: "https://alpine.inc/task/task-3/subtasks"}],
                },
                {type: "Text", text: " for "},
                {
                    type: "Mention",
                    reference: {
                        type: "Task",
                        id: "task-3",
                        title: "Ship it",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    });
});

test("will refuse a fresh read whose path no longer routes to anything", async () => {
    await putReadResponse(storage, "/mystery/page", {expirationTime: Date.now() + 60_000});

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__update",
            input: {path: "/mystery/page"},
        }),
    ).resolves.toEqual({ok: false});
});

test("will summarize the tools that carry no path as text", async () => {
    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "WebSearch",
            input: {query: "alpine productivity suite"},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [
                {type: "Text", text: "Search the web for \u201Calpine productivity suite\u201D"},
            ],
        },
    });

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {toolName: "WebSearch", input: {}}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Search the web"}]},
    });

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "WebFetch",
            input: {url: "https://example.com", prompt: "Summarize."},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Fetch https://example.com"}]},
    });

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {toolName: "WebFetch", input: {}}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Fetch a web page"}]},
    });
});

test("will title a create from a leading heading, and only a leading one", async () => {
    const summarize = async (input: unknown) =>
        await getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__create",
            input,
        });

    await expect(
        summarize({type: "document", content: "# Weekly Notes\n\nSome content."}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [{type: "Text", text: "Create a new document \u201CWeekly Notes\u201D"}],
        },
    });

    // Leading blank lines don't hide the title, and any heading depth counts.
    await expect(
        summarize({type: "document", content: "\n\n  \n## Roadmap Draft\n\nBody."}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {
            elements: [{type: "Text", text: "Create a new document \u201CRoadmap Draft\u201D"}],
        },
    });

    // A heading further down is a section title, not the page title.
    await expect(
        summarize({type: "document", content: "Just some intro text.\n\n# A Later Section"}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Create a new document"}]},
    });

    // An empty heading isn't a title.
    await expect(summarize({type: "document", content: "#   \n\nBody."})).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Create a new document"}]},
    });
});

test("will fall back to \u201Cpage\u201D when a create has no type", async () => {
    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__create",
            input: {content: "# Hello"},
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Create a new page \u201CHello\u201D"}]},
    });

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {toolName: "mcp__alpine__create", input: {}}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Create a new page"}]},
    });
});

test("will summarize generically when the input isn\u2019t an object", async () => {
    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {
            toolName: "mcp__alpine__create",
            input: "not an object",
        }),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Create a new page"}]},
    });

    await expect(
        getClaudeAgentApprovalSummaryContent(storage, {toolName: "WebSearch", input: null}),
    ).resolves.toEqual({
        ok: true,
        summaryContent: {elements: [{type: "Text", text: "Search the web"}]},
    });
});
