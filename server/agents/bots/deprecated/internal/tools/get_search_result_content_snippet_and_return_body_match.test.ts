import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    ZippedApiSearchResultMatches,
    getSearchResultContentSnippetAndReturnBodyMatch,
} from "~/server/agents/bots/deprecated/internal/tools/get_search_result_content_snippet_and_return_body_match.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";

function createTestSearchResult(bodyMatch: ZippedApiSearchResultMatches) {
    const matches: Array<{index: number; length: number}> = [];
    let index = 0;
    for (const segment of bodyMatch) {
        if (segment.isMatch && segment.text.length > 0) {
            matches.push({index, length: segment.text.length});
        }
        index += segment.text.length;
    }

    return {
        bodySnippet: {
            text: bodyMatch.map(segment => segment.text).join(""),
            matches,
        },
        author: createApiAccountMock({name: "John"}),
        type: "ChatMessage",
        id: generateId<ChatId>(),
        index: 0,
        title: null,
        parsedFilter: undefined,
    } as const;
}

describe("getSearchResultContentSnippetAndReturnBodyMatch", () => {
    test("returns Unknown chat message for empty body match", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {text: "Unknown chat message", isMatch: false},
            ],
            newBodyMatch: [],
        });
    });

    test("returns preview with author prefix and preserves marks", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {text: "Hello ", isMatch: false},
            {text: "world", isMatch: true},
            {text: " test", isMatch: false},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result.preview).toEqual([
            {text: "John: ", isMatch: false},
            {text: "Hello ", isMatch: false},
            {text: "world", isMatch: true},
            {text: " test", isMatch: false},
        ]);
        expect(result.newBodyMatch).toEqual([]);
    });

    test("truncates when content exceeds limit", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {
                text: "This is a very long text that will definitely exceed the maximum grapheme count limit",
                isMatch: false,
            },
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {
                    text: "This is a very long text that will definitely exceed",
                    isMatch: false,
                },
            ],
            newBodyMatch: [{text: " the maximum grapheme count limit", isMatch: false}],
        });
    });

    test("truncates at 50 graphemes including author prefix", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [{text: "a".repeat(75), isMatch: false}];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        // "John: " is 6 graphemes, leaving 44 graphemes for content Word boundary
        // expansion can add up to 14 more chars, so 64 total (6 + 44 + 14)
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {text: "a".repeat(64), isMatch: false},
            ],
            newBodyMatch: [{text: "a".repeat(11), isMatch: false}],
        });
    });

    test("includes all remaining segments after truncation point", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {text: "a".repeat(60), isMatch: false},
            {text: "second segment", isMatch: true},
            {text: "third segment", isMatch: false},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {text: "a".repeat(60), isMatch: false},
            ],
            newBodyMatch: [
                {text: "second segment", isMatch: true},
                {text: "third segment", isMatch: false},
            ],
        });
    });

    test("returns empty newBodyMatch when all content fits in preview", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {text: "Short", isMatch: false},
            {text: " text", isMatch: true},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {text: "Short", isMatch: false},
                {text: " text", isMatch: true},
            ],
            newBodyMatch: [],
        });
    });

    test("does not expand word boundary beyond 14 characters", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {
                text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecauseitsmuchtoolong",
                isMatch: false,
            },
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        // "John: " (6) + truncated text should not exceed 50+14 graphemes
        expect(result.preview).toEqual([
            {text: "John: ", isMatch: false},
            {
                text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecaus",
                isMatch: false,
            },
        ]);
        expect(result.newBodyMatch).toEqual([{text: "eitsmuchtoolong", isMatch: false}]);
    });

    test("drops empty string segments", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {text: "", isMatch: false},
            {text: "Hello", isMatch: true},
            {text: "", isMatch: false},
            {text: " world", isMatch: false},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result.preview).toEqual([
            {text: "John: ", isMatch: false},
            {text: "Hello", isMatch: true},
            {text: " world", isMatch: false},
        ]);
        expect(result.newBodyMatch).toEqual([]);
    });

    test("handles single character segments", () => {
        const bodyMatch: ZippedApiSearchResultMatches = [
            {text: "H", isMatch: true},
            {text: "e", isMatch: false},
            {text: "l", isMatch: true},
            {text: "l", isMatch: false},
            {text: "o", isMatch: true},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: ", isMatch: false},
                {text: "H", isMatch: true},
                {text: "e", isMatch: false},
                {text: "l", isMatch: true},
                {text: "l", isMatch: false},
                {text: "o", isMatch: true},
            ],
            newBodyMatch: [],
        });
    });

    describe("edge cases", () => {
        test("handles segments at exact grapheme boundary", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {text: "a".repeat(50), isMatch: false},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // With "John: " prefix (6 chars), only 44 chars fit within 50 limit But word
            // boundary expansion adds up to 6 more
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "a".repeat(50), isMatch: false},
                ],
                newBodyMatch: [],
            });
        });

        test("handles case where firstSpan after boundary is empty", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {
                    text: "This is a very long first segment that exceeds the 50 grapheme limit on its own",
                    isMatch: false,
                },
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {
                        text: "This is a very long first segment that exceeds the",
                        isMatch: false,
                    },
                ],
                newBodyMatch: [{text: " 50 grapheme limit on its own", isMatch: false}],
            });
        });

        test("handles all segments fitting exactly at limit", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {text: "a".repeat(22), isMatch: false},
                {text: "b".repeat(22), isMatch: true},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // "John: " (6) + 22 + 22 = 50 exactly
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "a".repeat(22), isMatch: false},
                    {text: "b".repeat(22), isMatch: true},
                ],
                newBodyMatch: [],
            });
        });

        test("handles very short content", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [{text: "Hi", isMatch: false}];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "Hi", isMatch: false},
                ],
                newBodyMatch: [],
            });
        });
    });

    describe("real-world scenarios", () => {
        test("handles complex search result with multiple matches", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {text: "This is a document about ", isMatch: false},
                {text: "machine learning", isMatch: true},
                {text: " and its applications in ", isMatch: false},
                {text: "AI", isMatch: true},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // Preview should preserve match markers
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "This is a document about ", isMatch: false},
                    {text: "machine learning", isMatch: true},
                    {text: " and its applications", isMatch: false},
                ],
                newBodyMatch: [
                    {text: " in ", isMatch: false},
                    {text: "AI", isMatch: true},
                ],
            });
        });

        test("handles very long search result with truncation", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {text: "This is a document about ", isMatch: false},
                {text: "machine learning", isMatch: true},
                {text: " and its applications in ", isMatch: false},
                {text: "artificial intelligence", isMatch: true},
                {text: ". We discuss various ", isMatch: false},
                {text: "algorithms", isMatch: true},
                {
                    text: " used in the field and their implementations in production systems.",
                    isMatch: false,
                },
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "This is a document about ", isMatch: false},
                    {text: "machine learning", isMatch: true},
                    {text: " and its applications", isMatch: false},
                ],
                newBodyMatch: [
                    {text: " in ", isMatch: false},
                    {text: "artificial intelligence", isMatch: true},
                    {text: ". We discuss various ", isMatch: false},
                    {text: "algorithms", isMatch: true},
                    {
                        text: " used in the field and their implementations in production systems.",
                        isMatch: false,
                    },
                ],
            });
        });

        test("preserves match information in remaining content", () => {
            const bodyMatch: ZippedApiSearchResultMatches = [
                {text: "Short intro ", isMatch: false},
                {
                    text: "This is matched content that is very long and will be cut off",
                    isMatch: true,
                },
                {text: " then ", isMatch: false},
                {text: "more matched", isMatch: true},
                {text: " and unmatched end", isMatch: false},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: ", isMatch: false},
                    {text: "Short intro ", isMatch: false},
                    {text: "This is matched content that is very long", isMatch: true},
                ],
                newBodyMatch: [
                    {text: " and will be cut off", isMatch: true},
                    {text: " then ", isMatch: false},
                    {text: "more matched", isMatch: true},
                    {text: " and unmatched end", isMatch: false},
                ],
            });
        });
    });
});
