import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {splitApiSearchMessageResultBodyMatch} from "~/server/agents/web/internal/split_api_search_message_result_body_match.js";
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

test("returns the missing entity title for an empty body match", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
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

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [
            {text: "John: "},
            {text: "Hello "},
            {text: "world", isMatch: true},
            {text: " test"},
        ],
        newBodyMatch: [],
    });
});

test("truncates when content exceeds the limit", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [
        {
            text: "This is a very long text that will definitely exceed the maximum grapheme count limit",
        },
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "John: "}, {text: "This is a very long text that will definitely exceed"}],
        newBodyMatch: [{text: " the maximum grapheme count limit"}],
    });
});

test("truncates at 50 graphemes plus the word boundary lookahead", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [{text: "a".repeat(75)}];

    // 50 graphemes fit in the preview. Since there's no word boundary in sight, the
    // lookahead adds `maxReasonableEnglishWordGraphemeCount` (14) more.
    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "John: "}, {text: "a".repeat(64)}],
        newBodyMatch: [{text: "a".repeat(11)}],
    });
});

test("includes all remaining segments after the truncation point", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [
        {text: "a".repeat(60)},
        {text: "second segment", isMatch: true},
        {text: "third segment"},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "John: "}, {text: "a".repeat(60)}],
        newBodyMatch: [{text: "second segment", isMatch: true}, {text: "third segment"}],
    });
});

test("does not expand the word boundary beyond 14 characters", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [
        {
            text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecauseitsmuchtoolong",
        },
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [
            {text: "John: "},
            {text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecaus"},
        ],
        newBodyMatch: [{text: "eitsmuchtoolong"}],
    });
});

test("expands to the nearest word boundary within the lookahead", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [
        {text: "This is a very long first segment that exceeds the 50 grapheme limit on its own"},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "John: "}, {text: "This is a very long first segment that exceeds the"}],
        newBodyMatch: [{text: " 50 grapheme limit on its own"}],
    });
});

test("splits a matched segment and preserves the mark on both halves", () => {
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

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
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

test("returns everything in the preview when segments fit exactly at the limit", () => {
    const bodyMatch: ApiSearchResultBodyMatch = [
        {text: "a".repeat(25)},
        {text: "b".repeat(25), isMatch: true},
    ];

    // 25 "a" graphemes plus 25 "b" graphemes is exactly the 50 grapheme limit (the
    // author prefix is not counted).
    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "John: "}, {text: "a".repeat(25)}, {text: "b".repeat(25), isMatch: true}],
        newBodyMatch: [],
    });
});
