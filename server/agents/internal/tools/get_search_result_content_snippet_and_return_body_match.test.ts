import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {getSearchResultContentSnippetAndReturnBodyMatch} from "~/server/agents/internal/tools/get_search_result_content_snippet_and_return_body_match.js";
import {ApiSearchResultBodyMatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

function createTestSearchResult(bodyMatch: ApiSearchResultBodyMatch) {
    return {
        bodyMatch,
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
        const bodyMatch: ApiSearchResultBodyMatch = [];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [{text: "John: "}, {text: "Unknown chat message"}],
            newBodyMatch: [],
        });
    });

    test("returns preview with author prefix and preserves marks", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {text: "Hello "},
            {text: "world", isMatch: true},
            {text: " test"},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result.preview).toEqual([
            {text: "John: "},
            {text: "Hello "},
            {text: "world", isMatch: true},
            {text: " test"},
        ]);
        expect(result.newBodyMatch).toEqual([]);
    });

    test("truncates when content exceeds limit", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {
                text: "This is a very long text that will definitely exceed the maximum grapheme count limit",
            },
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: "},
                {text: "This is a very long text that will definitely exceed"},
            ],
            newBodyMatch: [{text: " the maximum grapheme count limit"}],
        });
    });

    test("truncates at 50 graphemes including author prefix", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [{text: "a".repeat(75)}];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        // "John: " is 6 graphemes, leaving 44 graphemes for content Word boundary
        // expansion can add up to 14 more chars, so 64 total (6 + 44 + 14)
        expect(result).toEqual({
            preview: [{text: "John: "}, {text: "a".repeat(64)}],
            newBodyMatch: [{text: "a".repeat(11)}],
        });
    });

    test("includes all remaining segments after truncation point", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {text: "a".repeat(60)},
            {text: "second segment", isMatch: true},
            {text: "third segment"},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [{text: "John: "}, {text: "a".repeat(60)}],
            newBodyMatch: [{text: "second segment", isMatch: true}, {text: "third segment"}],
        });
    });

    test("returns empty newBodyMatch when all content fits in preview", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {text: "Short"},
            {text: " text", isMatch: true},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [{text: "John: "}, {text: "Short"}, {text: " text", isMatch: true}],
            newBodyMatch: [],
        });
    });

    test("does not expand word boundary beyond 14 characters", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {
                text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecauseitsmuchtoolong",
            },
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        // "John: " (6) + truncated text should not exceed 50+14 graphemes
        expect(result.preview).toEqual([
            {text: "John: "},
            {text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecaus"},
        ]);
        expect(result.newBodyMatch).toEqual([{text: "eitsmuchtoolong"}]);
    });

    test("handles empty string segments", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {text: ""},
            {text: "Hello", isMatch: true},
            {text: ""},
            {text: " world"},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result.preview).toEqual([
            {text: "John: "},
            {text: ""},
            {text: "Hello", isMatch: true},
            {text: ""},
            {text: " world"},
        ]);
        expect(result.newBodyMatch).toEqual([]);
    });

    test("handles single character segments", () => {
        const bodyMatch: ApiSearchResultBodyMatch = [
            {text: "H", isMatch: true},
            {text: "e"},
            {text: "l", isMatch: true},
            {text: "l"},
            {text: "o", isMatch: true},
        ];
        const result = getSearchResultContentSnippetAndReturnBodyMatch(
            createTestSearchResult(bodyMatch),
        );
        expect(result).toEqual({
            preview: [
                {text: "John: "},
                {text: "H", isMatch: true},
                {text: "e"},
                {text: "l", isMatch: true},
                {text: "l"},
                {text: "o", isMatch: true},
            ],
            newBodyMatch: [],
        });
    });

    describe("edge cases", () => {
        test("handles segments at exact grapheme boundary", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [{text: "a".repeat(50)}];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // With "John: " prefix (6 chars), only 44 chars fit within 50 limit But word
            // boundary expansion adds up to 6 more
            expect(result).toEqual({
                preview: [{text: "John: "}, {text: "a".repeat(50)}],
                newBodyMatch: [],
            });
        });

        test("handles case where firstSpan after boundary is empty", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [
                {
                    text: "This is a very long first segment that exceeds the 50 grapheme limit on its own",
                },
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: "},
                    {text: "This is a very long first segment that exceeds the"},
                ],
                newBodyMatch: [{text: " 50 grapheme limit on its own"}],
            });
        });

        test("handles all segments fitting exactly at limit", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [
                {text: "a".repeat(22)},
                {text: "b".repeat(22), isMatch: true},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // "John: " (6) + 22 + 22 = 50 exactly
            expect(result).toEqual({
                preview: [
                    {text: "John: "},
                    {text: "a".repeat(22)},
                    {text: "b".repeat(22), isMatch: true},
                ],
                newBodyMatch: [],
            });
        });

        test("handles very short content", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [{text: "Hi"}];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [{text: "John: "}, {text: "Hi"}],
                newBodyMatch: [],
            });
        });
    });

    describe("real-world scenarios", () => {
        test("handles complex search result with multiple matches", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [
                {text: "This is a document about "},
                {text: "machine learning", isMatch: true},
                {text: " and its applications in "},
                {text: "AI", isMatch: true},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            // Preview should preserve match markers
            expect(result).toEqual({
                preview: [
                    {text: "John: "},
                    {text: "This is a document about "},
                    {text: "machine learning", isMatch: true},
                    {text: " and its applications"},
                ],
                newBodyMatch: [{text: " in "}, {text: "AI", isMatch: true}],
            });
        });

        test("handles very long search result with truncation", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [
                {text: "This is a document about "},
                {text: "machine learning", isMatch: true},
                {text: " and its applications in "},
                {text: "artificial intelligence", isMatch: true},
                {text: ". We discuss various "},
                {text: "algorithms", isMatch: true},
                {text: " used in the field and their implementations in production systems."},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: "},
                    {text: "This is a document about "},
                    {text: "machine learning", isMatch: true},
                    {text: " and its applications"},
                ],
                newBodyMatch: [
                    {text: " in "},
                    {text: "artificial intelligence", isMatch: true},
                    {text: ". We discuss various "},
                    {text: "algorithms", isMatch: true},
                    {text: " used in the field and their implementations in production systems."},
                ],
            });
        });

        test("preserves match information in remaining content", () => {
            const bodyMatch: ApiSearchResultBodyMatch = [
                {text: "Short intro "},
                {
                    text: "This is matched content that is very long and will be cut off",
                    isMatch: true,
                },
                {text: " then "},
                {text: "more matched", isMatch: true},
                {text: " and unmatched end"},
            ];
            const result = getSearchResultContentSnippetAndReturnBodyMatch(
                createTestSearchResult(bodyMatch),
            );
            expect(result).toEqual({
                preview: [
                    {text: "John: "},
                    {text: "Short intro "},
                    {text: "This is matched content that is very long", isMatch: true},
                ],
                newBodyMatch: [
                    {text: " and will be cut off", isMatch: true},
                    {text: " then "},
                    {text: "more matched", isMatch: true},
                    {text: " and unmatched end"},
                ],
            });
        });
    });
});
