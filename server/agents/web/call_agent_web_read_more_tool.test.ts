import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    callAgentWebReadMoreTool,
    truncateAgentWebReadResponse,
} from "~/server/agents/web/call_agent_web_read_more_tool.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_read_more_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {api, storage, span};

function createDocumentContentFromParagraphs(paragraphTextList: ReadonlyArray<string>) {
    return parseApiContentFromMarkdown(paragraphTextList.join("\n\n"), {
        spaceId,
    }) as ApiContentResponse;
}

function createReadResponseFromString(responseString: string): {
    responseBytes: Uint8Array;
    newlineByteIndexes: ReadonlyArray<number>;
} {
    const responseBytes = new TextEncoder().encode(responseString);
    const newlineByteIndexes: Array<number> = [];

    for (let index = 0; index < responseBytes.length; index++) {
        if (responseBytes[index] === 10) {
            newlineByteIndexes.push(index);
        }
    }

    newlineByteIndexes.push(responseBytes.length);

    return {
        responseBytes,
        newlineByteIndexes,
    };
}

function parseSuggestedOffset(responseString: string): number {
    return Number(assertExists(responseString.match(/`offset` of ([0-9]+)/)?.[1]));
}

test("paginates through a long document across multiple read_more calls", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageLinkByPathname.put("/document/long-document", {
        type: "Document",
        id: documentId,
        title: "Long Document",
    });

    api.mockGetDocument(spaceId, documentId, {
        title: "Long Document",
        content: createDocumentContentFromParagraphs(
            Array.from({length: 24}, (_, index) => `Paragraph ${index + 1}: alpha beta gamma.`),
        ),
    });

    const firstResponse = await callAgentWebReadTool(context, {
        path: "/document/long-document",
        limit: "50b",
    });
    const firstOffset = parseSuggestedOffset(firstResponse);

    expect(firstResponse).toContain("Response truncated, 751b remaining.");

    const secondResponse = await callAgentWebReadMoreTool(context, {
        path: "/document/long-document",
        offset: firstOffset,
        limit: "50b",
    });
    const secondOffset = parseSuggestedOffset(secondResponse);

    expect(secondResponse).toContain("Response truncated, 719b remaining.");
    expect(secondResponse).toMatch(/^.+\n\n\(Response truncated/s);
    expect(secondOffset).toBeGreaterThan(firstOffset);

    const finalResponse = await callAgentWebReadMoreTool(context, {
        path: "/document/long-document",
        offset: secondOffset,
        limit: "10kb",
    });

    expect(finalResponse).toContain("End of file.");
    expect(finalResponse).not.toContain("Response truncated");
});

test("uses normalized path when reading cached responses", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageLinkByPathname.put("/document/path-normalized", {
        type: "Document",
        id: documentId,
        title: "Path Normalized",
    });

    api.mockGetDocument(spaceId, documentId, {
        title: "Path Normalized",
        content: createDocumentContentFromParagraphs(["Only one paragraph."]),
    });

    await callAgentWebReadTool(context, {
        path: "/document/path-normalized?b=2&a=1#ignored",
        limit: "10kb",
    });

    const responseString = await callAgentWebReadMoreTool(context, {
        path: "document/path-normalized?a=1&b=2#tail",
        offset: 1,
        limit: "10kb",
    });

    expect(responseString).toContain("# Path Normalized");
    expect(responseString).toContain("End of file.");
});

test("throws when read response does not exist", async () => {
    await expect(
        callAgentWebReadMoreTool(context, {
            path: "/document/missing",
            offset: 1,
            limit: "10kb",
        }),
    ).rejects.toThrow("Read response not found or expired");
});

test("throws when read response is expired", async () => {
    await context.storage.readResponseByPath.put("/document/expired", {
        expirationTime: new Date(Date.now() - 60_000),
        ...createReadResponseFromString("Expired content."),
    });

    await expect(
        callAgentWebReadMoreTool(context, {
            path: "/document/expired",
            offset: 1,
            limit: "10kb",
        }),
    ).rejects.toThrow("Read response not found or expired");
});

test.each([0, 1.5, 3])("throws for invalid offset %s", async offset => {
    await context.storage.readResponseByPath.put("/document/offset", {
        expirationTime: new Date(Date.now() + 60_000),
        ...createReadResponseFromString("Single line"),
    });

    await expect(
        callAgentWebReadMoreTool(context, {
            path: "/document/offset",
            offset,
            limit: "10kb",
        }),
    ).rejects.toThrow("Invalid offset line number");
});

describe("truncateAgentWebReadResponse", () => {
    test("returns the full remaining response with end-of-file line range", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("alpha\nbeta\ngamma"),
            {offsetLine: 0, limitBytes: 100},
        );

        expect(responseString).toBe("alpha\nbeta\ngamma\n\n(End of file. Showing lines 1-3 of 3.)");
    });

    test("returns the full remaining response with singular end-of-file line text", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("alpha\nbeta\ngamma"),
            {offsetLine: 2, limitBytes: 100},
        );

        expect(responseString).toBe("gamma\n\n(End of file. Showing line 3 of 3.)");
    });

    test("truncates to a newline when the newline is after half the byte limit", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 0, limitBytes: 10},
        );

        expect(responseString).toBe(
            "aaaaaa\n\n(Response truncated, 21b remaining. Showing line 1 of 4. Use the `read_more` tool with an `offset` of 2 to continue.)",
        );
    });

    test("truncates at the exact byte limit when newline would be too early", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("a\nbbbbbbbbbb\ncccc"),
            {offsetLine: 0, limitBytes: 10},
        );

        expect(responseString).toBe(
            "a\nbbbbbbbb\n\n(Response truncated, 7b remaining. Showing lines 1-2 of 3. Use the `read_more` tool with an `offset` of 2 to continue.)",
        );
    });

    test("trims adjacent newline candidates to avoid returning trailing blank lines", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("line1\n\n\nline2\nline3"),
            {offsetLine: 0, limitBytes: 8},
        );

        expect(responseString).toBe(
            "line1\n\n(Response truncated, 14b remaining. Showing line 1 of 5. Use the `read_more` tool with an `offset` of 2 to continue.)",
        );
    });

    test("truncates correctly from a non-zero offset", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 2, limitBytes: 12},
        );

        expect(responseString).toBe(
            "cccccc\nddddd\n\n(Response truncated, 1b remaining. Showing lines 3-4 of 4. Use the `read_more` tool with an `offset` of 4 to continue.)",
        );
    });

    test("truncates correctly in the middle of a line", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 2, limitBytes: 4},
        );

        expect(responseString).toBe(
            "cccc\n\n(Response truncated, 9b remaining. Showing line 3 of 4. Use the `read_more` tool with an `offset` of 3 and a higher `limit` to continue.)",
        );
    });
});
