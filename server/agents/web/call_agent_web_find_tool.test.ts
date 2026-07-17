import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_find_tool.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

afterEach(() => {
    import.meta.jest.useRealTimers();
});

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

async function seedReadResponse({
    path,
    response,
    expirationTime = new Date(Date.now() + 60_000),
}: {
    path: string;
    response: string;
    expirationTime?: Date;
}) {
    await context.storage.readResponseByPath.put(path, {
        expirationTime,
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 1, keys: []},
        ...createReadResponse(response),
    });
}

function callFindTool({
    path,
    pattern = "needle",
    offset = 0,
    limit = 20,
    matchLimit = "20b",
}: {
    path: string;
    pattern?: string;
    offset?: number;
    limit?: number;
    matchLimit?: string;
}) {
    return callAgentWebFindTool(context, {path, pattern, offset, limit, matchLimit});
}

test("returns only the matched line for matches at the start and end of a response", async () => {
    const path = "/document/find-boundaries";

    await seedReadResponse({
        path,
        response: "needle first\nmiddle\nlast needle",
    });

    const responseString = await callFindTool({
        path,
        matchLimit: "12b",
    });

    expect(responseString).toEqual(`\
Found 2 matches.

<match>

needle first

(Showing line 1.)

</match>

<match>

last needle

(Showing line 3.)

</match>`);
});

test("returns the zero-match count without requiring a reachable offset", async () => {
    const path = "/document/no-match";

    await seedReadResponse({path, response: "alpha\nbeta"});

    const responseString = await callFindTool({path});

    expect(responseString).toBe("Found 0 matches.");
});

test("paginates matches and only emits a continuation when later matches exist", async () => {
    const path = "/document/paginated-matches";

    await seedReadResponse({
        path,
        response: "zero needle\none needle\ntwo needle\nthree needle",
    });

    const firstPageString = await callFindTool({path, offset: 1, limit: 2});

    expect(firstPageString).toEqual(`\
Found 4 matches (showing 2 matches).

<match>

one needle

(Showing line 2.)

</match>

<match>

two needle

(Showing line 3.)

</match>

(Use \`offset\` of 3 to continue.)`);

    const finalPageString = await callFindTool({path, offset: 3, limit: 2});

    expect(finalPageString).toEqual(`\
Found 4 matches (showing 1 match).

<match>

three needle

(Showing line 4.)

</match>`);
});

test("includes nearby whole-line context while staying under the match limit", async () => {
    const path = "/document/match-context";

    await seedReadResponse({
        path,
        response: "intro\nbefore\nneedle\nafter\noutro",
    });

    const responseString = await callFindTool({path});

    expect(responseString).toEqual(`\
Found 1 match.

<match>

before needle after

(Showing lines 2-4.)

</match>`);
});

test("trims blank context lines from the start and end of a match preview", async () => {
    const path = "/document/blank-context";

    await seedReadResponse({
        path,
        response: "intro\n\nneedle\n\noutro",
    });

    const responseString = await callFindTool({path, matchLimit: "8b"});

    expect(responseString).toEqual(`\
Found 1 match.

<match>

needle

(Showing line 3.)

</match>`);
});

test("trims included leading blank context without removing the match", async () => {
    const path = "/document/leading-blank-context";

    await seedReadResponse({
        path,
        response: "intro\n\nneedle\nafter",
    });

    const responseString = await callFindTool({path, matchLimit: "20b"});

    expect(responseString).toEqual(`\
Found 1 match.

<match>

needle after

(Showing lines 3-4.)

</match>`);
});

test("truncates a long matched line around the match", async () => {
    const path = "/document/long-line";

    await seedReadResponse({
        path,
        response: "aaaaabbbbbccccc needle dddddeeeeefffff",
    });

    const responseString = await callFindTool({path, matchLimit: "12b"});

    expect(responseString).toEqual(`\
Found 1 match.

<match>

cc needle dd

(Showing line 1.)

</match>`);
});

test("truncates inside the match when the match is longer than the match limit", async () => {
    const path = "/document/long-match";

    await seedReadResponse({
        path,
        response: "prefix supercalifragilistic suffix",
    });

    const responseString = await callFindTool({
        path,
        pattern: "supercalifragilistic",
        matchLimit: "10b",
    });

    expect(responseString).toEqual(`\
Found 1 match.

<match>

supercalif

(Showing line 1.)

</match>`);
});

test("supports multiline regex matches across several lines", async () => {
    const path = "/document/multiline-regex";

    await seedReadResponse({
        path,
        response: "header\nstart\nmiddle\nfinish\nfooter",
    });

    const responseString = await callFindTool({
        path,
        pattern: "^start.*finish$",
        matchLimit: "20b",
    });

    expect(responseString).toEqual(`\
Found 1 match.

<match>

start middle finish

(Showing lines 2-4.)

</match>`);
});

test("supports zero-width regex matches", async () => {
    const path = "/document/zero-width";

    await seedReadResponse({
        path,
        response: "before\nneedle\nafter",
    });

    const responseString = await callFindTool({
        path,
        pattern: "(?=needle)",
        matchLimit: "6b",
    });

    expect(responseString).toEqual(`\
Found 1 match.

<match>

needle

(Showing line 2.)

</match>`);
});

test("normalizes paths before reading the cached response", async () => {
    const path = "/document/normalized?a=1&b=2";

    await seedReadResponse({
        path,
        response: "alpha\nneedle",
    });

    const responseString = await callFindTool({
        path: "document/normalized?a=1&b=2#ignored",
        matchLimit: "6b",
    });

    expect(responseString).toEqual(`\
Found 1 match.

<match>

needle

(Showing line 2.)

</match>`);
});

test("throws NotFoundError when the cached read response does not exist", async () => {
    await expect(callFindTool({path: "/document/missing"})).resolves.toEqual(
        "Error: Couldn\u2019t find pattern in `/document/missing`. Can\u2019t call the `find` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/missing` then call the `find` tool again. Or call the `search` tool if you don\u2019t know the exact path where the content you\u2019re looking for is.",
    );
});

test("throws NotFoundError when the cached read response is expired", async () => {
    import.meta.jest.useFakeTimers();

    const path = "/document/expired";
    const now = new Date("2026-01-01T00:00:00.000Z");
    import.meta.jest.setSystemTime(now);

    await seedReadResponse({
        path,
        response: "needle",
        expirationTime: new Date(now.getTime() - 1),
    });

    await expect(callFindTool({path})).resolves.toEqual(
        "Error: Couldn\u2019t find pattern in `/document/expired`. Can\u2019t call the `find` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/expired` then call the `find` tool again. Or call the `search` tool if you don\u2019t know the exact path where the content you\u2019re looking for is.",
    );
});

test.each([
    {name: "negative", offset: -1},
    {name: "fractional", offset: 0.5},
    {name: "past the last match", offset: 2},
])("throws FailedPreconditionError for $name offsets", async ({offset}) => {
    const path = `/document/invalid-offset-${offset}`;

    await seedReadResponse({
        path,
        response: "needle\nneedle",
    });

    await expect(callFindTool({path, offset})).resolves.toEqual(
        `Error: Couldn\u2019t find pattern in \`${path}\`. Found 2 matches so \`offset\` must be between 0 and 1. Instead \`offset\` is ${offset}.`,
    );
});

test.each([
    {name: "zero", limit: 0},
    {name: "negative", limit: -1},
    {name: "fractional", limit: 1.5},
])("throws FailedPreconditionError for $name limits", async ({limit}) => {
    const path = `/document/invalid-limit-${limit}`;

    await seedReadResponse({path, response: "needle"});

    await expect(callFindTool({path, limit})).resolves.toEqual(
        `Error: Couldn\u2019t find pattern in \`${path}\`. \`limit\` must be greater than 0. Instead \`limit\` is ${limit}.`,
    );
});

test("throws InvalidArgumentError when the match limit is malformed", async () => {
    await expect(
        callFindTool({path: "/document/anything", matchLimit: "not-a-byte-count"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t find pattern in `/document/anything`. Couldn\u2019t parse byte count from: `not-a-byte-count`. Byte count must be formatted as a number followed by a unit (e.g. 2.4kb) where the acceptable units are \u201Cb\u201D (bytes), \u201Ckb\u201D (kilobytes), \u201Cmb\u201D (megabytes), or \u201Cgb\u201D (gigabytes).",
    );
});
