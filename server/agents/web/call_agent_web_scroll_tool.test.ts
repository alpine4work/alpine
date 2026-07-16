import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {
    callAgentWebScrollTool,
    truncateAgentWebReadResponse,
} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_scroll_tool.test.ts");
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

function createDocumentContentFromParagraphs(paragraphTextList: ReadonlyArray<string>) {
    return parseApiContentFromMarkdown(paragraphTextList.join("\n\n")) as ApiContentResponse;
}

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

test("paginates through a long document across multiple scroll calls", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/long-document", {
        type: "Document",
        id: documentId,
        title: "Long Document",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Long Document",
        content: createDocumentContentFromParagraphs(
            Array.from({length: 24}, (_, index) => `Paragraph ${index + 1}: alpha beta gamma.`),
        ),
    });

    const firstResponse = await callAgentWebReadTool(context, {
        path: "/document/long-document",
        limit: "50b",
    });

    expect(firstResponse).toEqual(`\
# Long Document

Paragraph 1: alpha beta gamma.

(Page truncated, 749b remaining. Showing lines 1-4 of 49. Call the \`scroll\` tool with an \`offset\` of 4 to continue.)`);

    const secondResponse = await callAgentWebScrollTool(context, {
        path: "/document/long-document",
        offset: 4,
        limit: "50b",
    });

    expect(secondResponse).toEqual(`\
Paragraph 2: alpha beta gamma.

(Page truncated, 717b remaining. Showing lines 5-6 of 49. Use \`offset\` of 6 to continue.)`);

    const finalResponse = await callAgentWebScrollTool(context, {
        path: "/document/long-document",
        offset: 6,
        limit: "10kb",
    });

    expect(finalResponse).toEqual(`\
Paragraph 3: alpha beta gamma.

Paragraph 4: alpha beta gamma.

Paragraph 5: alpha beta gamma.

Paragraph 6: alpha beta gamma.

Paragraph 7: alpha beta gamma.

Paragraph 8: alpha beta gamma.

Paragraph 9: alpha beta gamma.

Paragraph 10: alpha beta gamma.

Paragraph 11: alpha beta gamma.

Paragraph 12: alpha beta gamma.

Paragraph 13: alpha beta gamma.

Paragraph 14: alpha beta gamma.

Paragraph 15: alpha beta gamma.

Paragraph 16: alpha beta gamma.

Paragraph 17: alpha beta gamma.

Paragraph 18: alpha beta gamma.

Paragraph 19: alpha beta gamma.

Paragraph 20: alpha beta gamma.

Paragraph 21: alpha beta gamma.

Paragraph 22: alpha beta gamma.

Paragraph 23: alpha beta gamma.

Paragraph 24: alpha beta gamma.

(End of file. Showing lines 7-49 of 49.)`);
});

test("paginates through a long GFM table across multiple scroll calls", async () => {
    const path = "/document/release-matrix-table";
    const tableResponseString = `\
# Release Matrix

| Milestone | Owner | Status |
| - | - | - |
| M01 API schema freeze | Platform | Done |
| M02 Query planner rollout | Search | In Progress |
| M03 Inbox notification polish | Comms | Planned |
| M04 Document AI suggestions | Docs | In Progress |
| M05 Agent memory sync | Agents | Planned |
| M06 Notification digests | Comms | Planned |
| M07 Permissions hardening | Security | In Review |
| M08 Search ranking tuning | Search | Planned |
| M09 Feed relevance update | Feed | Planned |
| M10 Realtime cursor optimizations | Realtime | In Progress |
| M11 Import migration tooling | Platform | Planned |
| M12 Workspace archive flow | Docs | Planned |`;

    await context.storage.readResponseByPath.put(path, {
        expirationTime: new Date(Date.now() + 60_000),
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 42, keys: []},
        ...createReadResponse(tableResponseString),
    });

    const firstResponseString = truncateAgentWebReadResponse(
        createReadResponse(tableResponseString),
        {offsetNewline: 0, limitLength: 180, isScrollTool: false},
    );

    expect(firstResponseString).toEqual(`\
# Release Matrix

| Milestone | Owner | Status |
| - | - | - |
| M01 API schema freeze | Platform | Done |
| M02 Query planner rollout | Search | In Progress |
(Page truncated, 510b remaining. Showing lines 1-6 of 16. Call the \`scroll\` tool with an \`offset\` of 6 to continue.)`);

    const secondResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 6,
        limit: "180b",
    });

    expect(secondResponseString).toEqual(`\
| M03 Inbox notification polish | Comms | Planned |
| M04 Document AI suggestions | Docs | In Progress |
| M05 Agent memory sync | Agents | Planned |
(Page truncated, 360b remaining. Showing lines 7-9 of 16. Use \`offset\` of 9 to continue.)`);

    const thirdResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 9,
        limit: "180b",
    });

    expect(thirdResponseString).toEqual(`\
| M06 Notification digests | Comms | Planned |
| M07 Permissions hardening | Security | In Review |
| M08 Search ranking tuning | Search | Planned |
(Page truncated, 211b remaining. Showing lines 10-12 of 16. Use \`offset\` of 12 to continue.)`);

    const fourthResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 12,
        limit: "180b",
    });

    expect(fourthResponseString).toEqual(`\
| M09 Feed relevance update | Feed | Planned |
| M10 Realtime cursor optimizations | Realtime | In Progress |
| M11 Import migration tooling | Platform | Planned |
(Page truncated, 47b remaining. Showing lines 13-15 of 16. Use \`offset\` of 15 to continue.)`);

    const fifthResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 15,
        limit: "180b",
    });

    expect(fifthResponseString).toEqual(`\
| M12 Workspace archive flow | Docs | Planned |

(End of file. Showing line 16 of 16.)`);
});

test("iterates through realistic wikipedia content one page at a time", async () => {
    const documentId = generateId<DocumentId>();
    const path = "/document/youtube";

    await context.storage.pageStoredLinkByPathname.put(path, {
        type: "Document",
        id: documentId,
        title: "YouTube",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "YouTube",
        content: addKeysToApiContentForTest(
            intoApiContent(wikipediaYoutubeDocumentContent.get(), {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            }),
        ),
    });

    const firstResponseString = await callAgentWebReadTool(context, {
        path,
        limit: "2kb",
    });

    expect(firstResponseString).toEqual(`\
# YouTube

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California, United States. Accessible worldwide, it was launched on February 14, 2005, by Steve Chen, Chad Hurley, and Jawed Karim. It is owned by Google and is the second most visited website in the world, after Google Search. YouTube has more than 2.5 billion monthly users, who collectively watch more than one billion hours of videos every day. As of May 2019, videos were being uploaded to the platform at a rate of more than 500 hours of content per minute.

In October 2006, YouTube was bought by Google for $1.65 billion. Google\u2019s ownership of YouTube expanded the site\u2019s business model, expanding from generating revenue from advertisements alone to offering paid content such as movies and exclusive content produced by YouTube. It also offers YouTube Premium, a paid subscription option for watching content without ads. YouTube also approved creators to participate in Google\u2019s AdSense program, which seeks to generate more revenue for both parties. In 2021, YouTube\u2019s annual advertising revenue increased to $28.8 billion, an increase in revenue of $9 billion from the previous year. YouTube reported revenue of $29.2 billion in 2022.

Since its purchase by Google, YouTube has expanded beyond the core website into mobile apps, network television, and the ability to link with other platforms. Video categories on YouTube include music videos, video clips, news, short films, feature films, songs, documentaries, movie trailers, teasers, live streams, vlogs, and more. Most content is generated by individuals, including collaborations between YouTubers and corporate sponsors. Established media corporations such as Disney, Paramount, NBCUniversal, and Warner Bros. Discovery have also created and expanded their corporate YouTube channels to advertise to a greater audience.

(Page truncated, 3.6kb remaining. Showing lines 1-8 of 21. Call the \`scroll\` tool with an \`offset\` of 8 to continue.)`);

    const secondResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 8,
        limit: "2kb",
    });

    expect(secondResponseString).toEqual(`\
YouTube has had unprecedented social impact, influencing popular culture, internet trends, and creating multimillionaire celebrities. Despite its growth and success, it has been widely criticized for allegedly facilitating the spread of misinformation, the sharing of copyrighted content, routinely violating its users\u2019 privacy, enabling censorship, endangering child safety and wellbeing, and for its inconsistent or incorrect implementation of platform guidelines.

## History

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim. The trio were early employees of PayPal, which left them enriched after the company was bought by eBay. Hurley had studied design at the Indiana University of Pennsylvania, and Chen and Karim studied computer science together at the University of Illinois Urbana-Champaign.

According to a story that has often been repeated in the media, Hurley and Chen developed the idea for YouTube during the early months of 2005, after they had experienced difficulty sharing videos that had been shot at a dinner party at Chen\u2019s apartment in San Francisco. Karim did not attend the party and denied that it had occurred, but Chen remarked that the idea that YouTube was founded after a dinner party \u201Cwas probably very strengthened by marketing ideas around creating a story that was very digestible\u201D.

(Page truncated, 2.27kb remaining. Showing lines 9-16 of 21. Use \`offset\` of 16 to continue.)`);

    const thirdResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 16,
        limit: "2kb",
    });

    expect(thirdResponseString).toEqual(`\
YouTube began as a venture capital–funded technology startup. Between November 2005 and April 2006, the company raised money from various investors, with Sequoia Capital and Artis Capital Management being the largest two. YouTube\u2019s early headquarters were situated above a pizzeria and a Japanese restaurant in San Mateo, California. In February 2005, the company activated www.youtube.com. The first video was uploaded on April 23, 2005. Titled \u201CMe at the zoo\u201D, it shows co-founder Jawed Karim at the San Diego Zoo and can still be viewed on the site. In May, the company launched a public beta and by November, a Nike ad featuring Ronaldinho became the first video to reach one million total views. The site launched officially on December 15, 2005, by which time the site was receiving 8 million views a day. Clips at the time were limited to 100 megabytes, as little as 30 seconds of footage.

YouTube was not the first video-sharing site on the Internet; Vimeo was launched in November 2004, though that site remained a side project of its developers from CollegeHumor. The week of YouTube\u2019s launch, NBC-Universal\u2019s Saturday Night Live ran a skit \u201DLazy Sunday\u201D by The Lonely Island. Besides helping to bolster ratings and long-term viewership for Saturday Night Live, \u201DLazy Sunday\u201D\u2019s status as an early viral video helped establish YouTube as an important website. Unofficial uploads of the skit to YouTube drew in more than five million collective views by February 2006 before they were removed when NBCUniversal requested it two months later based on copyright concerns. Despite eventually being taken down, these duplicate uploads of the skit helped popularize YouTube\u2019s reach and led to the upload of more third-party content. The site grew rapidly; in July 2006, the company announced that more than 65,000 new videos were being uploaded every day and that the site was receiving 100 million video views per day.

(Page truncated, 341b remaining. Showing lines 17-20 of 21. Use \`offset\` of 20 to continue.)`);

    const fourthResponseString = await callAgentWebScrollTool(context, {
        path,
        offset: 20,
        limit: "2kb",
    });

    expect(fourthResponseString).toEqual(`\
The choice of the name www.youtube.com led to problems for a similarly named website, www.utube.com. That site\u2019s owner, Universal Tube & Rollform Equipment, filed a lawsuit against YouTube in November 2006 after being regularly overloaded by people looking for YouTube. Universal Tube subsequently changed its website to www.utubeonline.com.

(End of file. Showing line 21 of 21.)`);
});

test("uses normalized path when reading cached responses", async () => {
    const documentId = generateId<DocumentId>();

    await context.storage.pageStoredLinkByPathname.put("/document/path-normalized", {
        type: "Document",
        id: documentId,
        title: "Path Normalized",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Path Normalized",
        content: createDocumentContentFromParagraphs(["Only one paragraph."]),
    });

    await callAgentWebReadTool(context, {
        path: "/document/path-normalized?a=1&b=2#ignored",
        limit: "10kb",
    });

    const responseString = await callAgentWebScrollTool(context, {
        path: "document/path-normalized?a=1&b=2#tail",
        offset: 0,
        limit: "10kb",
    });

    expect(responseString).toEqual(`\
# Path Normalized

Only one paragraph.

(End of file. Showing lines 1-3 of 3.)`);
});

test("throws when read response does not exist", async () => {
    await expect(
        callAgentWebScrollTool(context, {
            path: "/document/missing",
            offset: 0,
            limit: "10kb",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t scroll `/document/missing`. Can\u2019t call the `scroll` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/missing` then call the `scroll` tool again.",
    );
});

test("throws when read response is expired", async () => {
    await context.storage.readResponseByPath.put("/document/expired", {
        expirationTime: new Date(Date.now() - 60_000),
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 42, keys: []},
        ...createReadResponse("Expired content."),
    });

    await expect(
        callAgentWebScrollTool(context, {
            path: "/document/expired",
            offset: 0,
            limit: "10kb",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t scroll `/document/expired`. Can\u2019t call the `scroll` tool for a path that hasn\u2019t been read recently. Call the `read` tool with the path `/document/expired` then call the `scroll` tool again.",
    );
});

test.each([-1, 1.5, 3])("throws for invalid offset %s", async offset => {
    await context.storage.readResponseByPath.put("/document/offset", {
        expirationTime: new Date(Date.now() + 60_000),
        pageMetadata: {type: "Document", id: generateId<DocumentId>(), version: 42, keys: []},
        ...createReadResponse("Single line"),
    });

    await expect(
        callAgentWebScrollTool(context, {
            path: "/document/offset",
            offset,
            limit: "10kb",
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t scroll \`/document/offset\`. The \`offset\` line number must be between 0 and 0. Instead \`offset\` is ${offset}.`,
    );
});

describe("truncateAgentWebReadResponse", () => {
    test("returns the full remaining response with end-of-file line range", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("alpha\nbeta\ngamma"),
            {offsetNewline: 0, limitLength: 100, isScrollTool: true},
        );

        expect(responseString).toBe("alpha\nbeta\ngamma\n\n(End of file. Showing lines 1-3 of 3.)");
    });

    test("returns the full remaining response with singular end-of-file line text", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("alpha\nbeta\ngamma"),
            {offsetNewline: 2, limitLength: 100, isScrollTool: true},
        );

        expect(responseString).toBe("gamma\n\n(End of file. Showing line 3 of 3.)");
    });

    test("truncates to a newline when the newline is after half the byte limit", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetNewline: 0, limitLength: 10, isScrollTool: true},
        );

        expect(responseString).toBe(
            "aaaaaa\n(Page truncated, 20b remaining. Showing line 1 of 4. Use `offset` of 1 to continue.)",
        );
    });

    test("truncates at the exact byte limit when newline would be too early", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("a\nbbbbbbbbbb\ncccc"),
            {offsetNewline: 0, limitLength: 10, isScrollTool: true},
        );

        expect(responseString).toBe(
            "a\nbbbbbbbb(Page truncated, 7b remaining. Showing lines 1-2 of 3. Use `offset` of 2 to continue.)",
        );
    });

    test("trims adjacent newline candidates to avoid returning trailing blank lines", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("line1\n\n\nline2\nline3"),
            {offsetNewline: 0, limitLength: 8, isScrollTool: true},
        );

        expect(responseString).toBe(
            "line1\n\n\n(Page truncated, 11b remaining. Showing lines 1-3 of 5. Use `offset` of 3 to continue.)",
        );
    });

    test("truncates correctly from a non-zero offset", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetNewline: 2, limitLength: 12, isScrollTool: true},
        );

        expect(responseString).toBe(
            "cccccc\nddddd(Page truncated, 1b remaining. Showing lines 3-4 of 4. Use `offset` of 4 to continue.)",
        );
    });

    test("truncates correctly in the middle of a line", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponse("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetNewline: 2, limitLength: 4, isScrollTool: true},
        );

        expect(responseString).toBe(
            "cccc(Page truncated, 9b remaining. Showing line 3 of 4. Use `offset` of 2 and a higher `limit` to continue.)",
        );
    });
});
