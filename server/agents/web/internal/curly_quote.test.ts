import {curlyQuote} from "~/server/agents/web/internal/curly_quote.js";

test("quotes plain text content", () => {
    expect(curlyQuote([{type: "text", value: "Hello, world!"}])).toBe("\u201CHello, world!\u201D");
});

test("quotes text extracted from nested phrasing nodes", () => {
    expect(
        curlyQuote([
            {type: "text", value: "Alpha "},
            {
                type: "emphasis",
                children: [{type: "text", value: "Beta"}],
            },
            {
                type: "link",
                url: "/doc/1",
                children: [{type: "text", value: " Gamma"}],
            },
            {type: "text", value: "!"},
        ]),
    ).toBe("\u201CAlpha Beta Gamma!\u201D");
});

test("truncates text content longer than 50 characters", () => {
    expect(curlyQuote([{type: "text", value: "a".repeat(55)}])).toBe(
        `\u201C${"a".repeat(50)}…\u201D`,
    );
});

test("appends a closing curly quote when markdown has unmatched opening quote", () => {
    expect(curlyQuote([{type: "text", value: "He said \u201Chello"}])).toBe(
        "\u201CHe said \u201Chello\u201D\u201D",
    );
});

test("prepends an opening curly quote when markdown has unmatched closing quote", () => {
    expect(
        curlyQuote([{type: "text", value: "hello\u201D is it me you\u2019re looking for?"}]),
    ).toBe("\u201C\u201Chello\u201D is it me you\u2019re looking for?\u201D");
});

test("balances curly quotes after truncation", () => {
    expect(curlyQuote([{type: "text", value: `\u201C${"a".repeat(80)}`}])).toBe(
        `\u201C\u201C${"a".repeat(49)}…\u201D\u201D`,
    );
});
