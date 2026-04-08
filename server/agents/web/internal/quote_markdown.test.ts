import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";

test("quotes plain text content", () => {
    expect(quoteMarkdown([{type: "text", value: "Hello, world!"}])).toBe("“Hello, world!”");
});

test("quotes text extracted from nested phrasing nodes", () => {
    expect(
        quoteMarkdown([
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
    ).toBe("“Alpha Beta Gamma!”");
});

test("truncates text content longer than 50 characters", () => {
    expect(quoteMarkdown([{type: "text", value: "a".repeat(55)}])).toBe(`“${"a".repeat(50)}…”`);
});

test("appends a closing curly quote when markdown has unmatched opening quote", () => {
    expect(quoteMarkdown([{type: "text", value: "He said “hello"}])).toBe("“He said “hello””");
});

test("prepends an opening curly quote when markdown has unmatched closing quote", () => {
    expect(quoteMarkdown([{type: "text", value: "hello” is it me you’re looking for?"}])).toBe(
        "““hello” is it me you’re looking for?”",
    );
});

test("balances curly quotes after truncation", () => {
    expect(quoteMarkdown([{type: "text", value: `“${"a".repeat(80)}`}])).toBe(
        `““${"a".repeat(49)}…””`,
    );
});
