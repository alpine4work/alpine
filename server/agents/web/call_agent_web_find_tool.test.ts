import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_find_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {api, storage, span};

function createReadResponse(response: string): {
    response: string;
    newlineIndexes: ReadonlyArray<number>;
} {
    const newlineIndexes: Array<number> = [];

    for (let index = 0; index < response.length; index++) {
        if (response[index] === "\n") {
            newlineIndexes.push(index);
        }
    }

    newlineIndexes.push(response.length);

    return {
        response,
        newlineIndexes,
    };
}

test("returns line context for every regex match", async () => {
    const path = "/document/find";
    const response = "needle\nmiddle\nneedle";

    await context.storage.readResponseByPath.put(path, {
        expirationTime: new Date(Date.now() + 60_000),
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 1},
        ...createReadResponse(response),
    });

    const responseString = await callAgentWebFindTool(context, {
        path,
        pattern: "needle",
        matchLimit: "6b",
    });

    expect(responseString).toBe(`\
Found 2 matches.

<match>
needle
(Showing line 1.)
</match>

<match>
needle
(Showing line 3.)
</match>`);
});

test("returns the no-match count", async () => {
    const path = "/document/no-match";

    await context.storage.readResponseByPath.put(path, {
        expirationTime: new Date(Date.now() + 60_000),
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 1},
        ...createReadResponse("alpha\nbeta"),
    });

    const responseString = await callAgentWebFindTool(context, {
        path,
        pattern: "needle",
        matchLimit: "10b",
    });

    expect(responseString).toBe("Found 0 matches.");
});

test("throws when read response does not exist", async () => {
    await expect(
        callAgentWebFindTool(context, {
            path: "/document/missing",
            pattern: "needle",
            matchLimit: "10b",
        }),
    ).rejects.toThrow("Read response not found or expired");
});
