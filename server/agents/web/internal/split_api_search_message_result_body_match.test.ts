import {splitApiSearchMessageResultBodyMatch} from "~/server/agents/web/internal/split_api_search_message_result_body_match.js";

type ApiSearchResultMatchItemWithText = {text: string; isMatch?: true};

function createTestSearchResult(bodyMatch: ReadonlyArray<ApiSearchResultMatchItemWithText>) {
    return {
        body: bodyMatch.map(segment => segment.text).join(""),
        bodyMatch: bodyMatch.map(segment => ({
            length: segment.text.length,
            ...(segment.isMatch ? {isMatch: true as const} : {}),
        })),
        type: "ChatMessage",
    } as const;
}

test("returns the missing entity title for an empty body match", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "Unknown chat message"}],
        newBodyMatch: [],
    });
});

test("returns the message preview and preserves marks", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {text: "Hello "},
        {text: "world", isMatch: true},
        {text: " test"},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "Hello "}, {text: "world", isMatch: true}, {text: " test"}],
        newBodyMatch: [],
    });
});

test("truncates when content exceeds the limit", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {
            text: "This is a very long text that will definitely exceed the maximum grapheme count limit",
        },
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "This is a very long text that will definitely exceed"}],
        newBodyMatch: [{text: " the maximum grapheme count limit"}],
    });
});

test("truncates at the hard limit when there is no word boundary", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [{text: "a".repeat(75)}];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "a".repeat(64)}],
        newBodyMatch: [{text: "a".repeat(11)}],
    });
});

test("continues the preview across body match segments", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {text: "a".repeat(60)},
        {text: "second segment", isMatch: true},
        {text: "third segment"},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "a".repeat(60)}, {text: "seco", isMatch: true}],
        newBodyMatch: [{text: "nd segment", isMatch: true}, {text: "third segment"}],
    });
});

test("does not expand the word boundary beyond 14 characters", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {
            text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecauseitsmuchtoolong",
        },
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "Hello verylongwordthatexceedsthefourteencharacterthresholdbecaus"}],
        newBodyMatch: [{text: "eitsmuchtoolong"}],
    });
});

test("expands to the nearest word boundary within the lookahead", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {text: "This is a very long first segment that exceeds the 50 grapheme limit on its own"},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "This is a very long first segment that exceeds the"}],
        newBodyMatch: [{text: " 50 grapheme limit on its own"}],
    });
});

test("splits a matched segment and preserves the mark on both halves", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
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

test("returns everything when the message ends before the hard limit", () => {
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [
        {text: "a".repeat(25)},
        {text: "b".repeat(25), isMatch: true},
    ];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: "a".repeat(25)}, {text: "b".repeat(25), isMatch: true}],
        newBodyMatch: [],
    });
});

test("splits Unicode text at grapheme boundaries", () => {
    const emoji = "👩‍💻";
    const bodyMatch: Array<ApiSearchResultMatchItemWithText> = [{text: emoji.repeat(50) + " rest"}];

    expect(splitApiSearchMessageResultBodyMatch(createTestSearchResult(bodyMatch))).toEqual({
        preview: [{text: emoji.repeat(50)}],
        newBodyMatch: [{text: " rest"}],
    });
});
