import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    callAgentWebReadMoreTool,
    truncateAgentWebReadResponse,
} from "~/server/agents/web/call_agent_web_read_more_tool.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {wikipediaYoutubeDocumentContent} from "~/shared/documents/fixtures/wikipedia_youtube_document_content.js";
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

    expect(firstResponse).toEqual(`\
# Long Document

Paragraph 1: alpha beta gamma.

(Response truncated, 749b remaining. Showing lines 1-4 of 49. Call the \`read_more\` tool with an \`offset\` of 5 to continue.)`);

    const secondResponse = await callAgentWebReadMoreTool(context, {
        path: "/document/long-document",
        offset: 5,
        limit: "50b",
    });

    expect(secondResponse).toEqual(`\
Paragraph 2: alpha beta gamma.

(Response truncated, 717b remaining. Showing lines 5-6 of 49. Use \`offset\` of 7 to continue.)`);

    const finalResponse = await callAgentWebReadMoreTool(context, {
        path: "/document/long-document",
        offset: 7,
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

test("iterates through realistic wikipedia content one page at a time", async () => {
    const documentId = generateId<DocumentId>();
    const path = "/document/youtube";

    await context.storage.pageLinkByPathname.put(path, {
        type: "Document",
        id: documentId,
        title: "YouTube",
    });

    api.mockGetDocument(spaceId, documentId, {
        title: "YouTube",
        content: intoApiContent(wikipediaYoutubeDocumentContent.get(), {
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
        }),
    });

    const firstResponseString = await callAgentWebReadTool(context, {
        path,
        limit: "2kb",
    });

    expect(firstResponseString).toEqual(`\
# YouTube

YouTube is an American online video sharing and social media platform headquartered in San Bruno, California, United States. Accessible worldwide, it was launched on February 14, 2005, by Steve Chen, Chad Hurley, and Jawed Karim. It is owned by Google and is the second most visited website in the world, after Google Search. YouTube has more than 2.5 billion monthly users, who collectively watch more than one billion hours of videos every day. As of May 2019, videos were being uploaded to the platform at a rate of more than 500 hours of content per minute.

In October 2006, YouTube was bought by Google for $1.65 billion. Google’s ownership of YouTube expanded the site’s business model, expanding from generating revenue from advertisements alone to offering paid content such as movies and exclusive content produced by YouTube. It also offers YouTube Premium, a paid subscription option for watching content without ads. YouTube also approved creators to participate in Google’s AdSense program, which seeks to generate more revenue for both parties. In 2021, YouTube’s annual advertising revenue increased to $28.8 billion, an increase in revenue of $9 billion from the previous year. YouTube reported revenue of $29.2 billion in 2022.

Since its purchase by Google, YouTube has expanded beyond the core website into mobile apps, network television, and the ability to link with other platforms. Video categories on YouTube include music videos, video clips, news, short films, feature films, songs, documentaries, movie trailers, teasers, live streams, vlogs, and more. Most content is generated by individuals, including collaborations between YouTubers and corporate sponsors. Established media corporations such as Disney, Paramount, NBCUniversal, and Warner Bros. Discovery have also created and expanded their corporate YouTube channels to advertise to a greater audience.

(Response truncated, 3.64kb remaining. Showing lines 1-8 of 21. Call the \`read_more\` tool with an \`offset\` of 9 to continue.)`);

    const secondResponseString = await callAgentWebReadMoreTool(context, {
        path,
        offset: 9,
        limit: "2kb",
    });

    expect(secondResponseString).toEqual(`\
YouTube has had unprecedented social impact, influencing popular culture, internet trends, and creating multimillionaire celebrities. Despite its growth and success, it has been widely criticized for allegedly facilitating the spread of misinformation, the sharing of copyrighted content, routinely violating its users’ privacy, enabling censorship, endangering child safety and wellbeing, and for its inconsistent or incorrect implementation of platform guidelines.

## History

YouTube was founded by Steve Chen, Chad Hurley, and Jawed Karim. The trio were early employees of PayPal, which left them enriched after the company was bought by eBay. Hurley had studied design at the Indiana University of Pennsylvania, and Chen and Karim studied computer science together at the University of Illinois Urbana-Champaign.

According to a story that has often been repeated in the media, Hurley and Chen developed the idea for YouTube during the early months of 2005, after they had experienced difficulty sharing videos that had been shot at a dinner party at Chen’s apartment in San Francisco. Karim did not attend the party and denied that it had occurred, but Chen remarked that the idea that YouTube was founded after a dinner party “was probably very strengthened by marketing ideas around creating a story that was very digestible”.

(Response truncated, 2.29kb remaining. Showing lines 9-16 of 21. Use \`offset\` of 17 to continue.)`);

    const thirdResponseString = await callAgentWebReadMoreTool(context, {
        path,
        offset: 17,
        limit: "2kb",
    });

    expect(thirdResponseString).toEqual(`\
YouTube began as a venture capital–funded technology startup. Between November 2005 and April 2006, the company raised money from various investors, with Sequoia Capital and Artis Capital Management being the largest two. YouTube’s early headquarters were situated above a pizzeria and a Japanese restaurant in San Mateo, California. In February 2005, the company activated www.youtube.com. The first video was uploaded on April 23, 2005. Titled “Me at the zoo”, it shows co-founder Jawed Karim at the San Diego Zoo and can still be viewed on the site. In May, the company launched a public beta and by November, a Nike ad featuring Ronaldinho became the first video to reach one million total views. The site launched officially on December 15, 2005, by which time the site was receiving 8 million views a day. Clips at the time were limited to 100 megabytes, as little as 30 seconds of footage.

YouTube was not the first video-sharing site on the Internet; Vimeo was launched in November 2004, though that site remained a side project of its developers from CollegeHumor. The week of YouTube’s launch, NBC-Universal’s Saturday Night Live ran a skit ”Lazy Sunday” by The Lonely Island. Besides helping to bolster ratings and long-term viewership for Saturday Night Live, ”Lazy Sunday”’s status as an early viral video helped establish YouTube as an important website. Unofficial uploads of the skit to YouTube drew in more than five million collective views by February 2006 before they were removed when NBCUniversal requested it two months later based on copyright concerns. Despite eventually being taken down, these duplicate uploads of the skit helped popularize YouTube’s reach and led to the upload of more third-party content. The site grew rapidly; in July 2006, the company announced that more than 65,000 new videos were being uploaded every day and that the site was receiving 100 million video views per day.

(Response truncated, 343b remaining. Showing lines 17-20 of 21. Use \`offset\` of 21 to continue.)`);

    const fourthResponseString = await callAgentWebReadMoreTool(context, {
        path,
        offset: 21,
        limit: "2kb",
    });

    expect(fourthResponseString).toEqual(`\
The choice of the name www.youtube.com led to problems for a similarly named website, www.utube.com. That site’s owner, Universal Tube & Rollform Equipment, filed a lawsuit against YouTube in November 2006 after being regularly overloaded by people looking for YouTube. Universal Tube subsequently changed its website to www.utubeonline.com.

(End of file. Showing line 21 of 21.)`);
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

    expect(responseString).toEqual(`\
# Path Normalized

Only one paragraph.

(End of file. Showing lines 1-3 of 3.)`);
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
            {offsetLine: 0, limitBytes: 100, isReadMoreTool: true},
        );

        expect(responseString).toBe("alpha\nbeta\ngamma\n\n(End of file. Showing lines 1-3 of 3.)");
    });

    test("returns the full remaining response with singular end-of-file line text", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("alpha\nbeta\ngamma"),
            {offsetLine: 2, limitBytes: 100, isReadMoreTool: true},
        );

        expect(responseString).toBe("gamma\n\n(End of file. Showing line 3 of 3.)");
    });

    test("truncates to a newline when the newline is after half the byte limit", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 0, limitBytes: 10, isReadMoreTool: true},
        );

        expect(responseString).toBe(
            "aaaaaa\n(Response truncated, 20b remaining. Showing line 1 of 4. Use `offset` of 2 to continue.)",
        );
    });

    test("truncates at the exact byte limit when newline would be too early", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("a\nbbbbbbbbbb\ncccc"),
            {offsetLine: 0, limitBytes: 10, isReadMoreTool: true},
        );

        expect(responseString).toBe(
            "a\nbbbbbbbb(Response truncated, 7b remaining. Showing lines 1-2 of 3. Use `offset` of 2 to continue.)",
        );
    });

    test("trims adjacent newline candidates to avoid returning trailing blank lines", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("line1\n\n\nline2\nline3"),
            {offsetLine: 0, limitBytes: 8, isReadMoreTool: true},
        );

        expect(responseString).toBe(
            "line1\n\n\n(Response truncated, 11b remaining. Showing lines 1-3 of 5. Use `offset` of 4 to continue.)",
        );
    });

    test("truncates correctly from a non-zero offset", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 2, limitBytes: 12, isReadMoreTool: true},
        );

        expect(responseString).toBe(
            "cccccc\nddddd(Response truncated, 1b remaining. Showing lines 3-4 of 4. Use `offset` of 4 to continue.)",
        );
    });

    test("truncates correctly in the middle of a line", () => {
        const responseString = truncateAgentWebReadResponse(
            createReadResponseFromString("aaaaaa\nbbbbbb\ncccccc\ndddddd"),
            {offsetLine: 2, limitBytes: 4, isReadMoreTool: true},
        );

        expect(responseString).toBe(
            "cccc(Response truncated, 9b remaining. Showing line 3 of 4. Use `offset` of 3 and a higher `limit` to continue.)",
        );
    });
});
