import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";

function massage(iterable: Iterable<{index: number; emoji: string}>) {
    return Array.from(iterable, ({emoji}) => emoji);
}

test("finds no emojis in string with no emojis", () => {
    expect(massage(iterateEmojis("test"))).toEqual([]);
});

test("finds emojis at the end of string", () => {
    expect(massage(iterateEmojis("test👩"))).toEqual(["\u{1F469}"]);
});

test("finds emojis at the start of string", () => {
    expect(massage(iterateEmojis("👩test"))).toEqual(["\u{1F469}"]);
});

test("finds emoji when it’s the only character", () => {
    expect(massage(iterateEmojis("👩"))).toEqual(["\u{1F469}"]);
});

test("finds modified emoji", () => {
    expect(massage(iterateEmojis("👩🏿"))).toEqual(["\u{1F469}\u{1F3FF}"]);
});

test("finds joined emojis", () => {
    expect(massage(iterateEmojis("👨‍👩‍👧‍👧"))).toEqual([
        "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F467}",
    ]);
});

test("finds emojis with default emoji rendering", () => {
    expect(massage(iterateEmojis("😂"))).toEqual(["\u{1F602}"]);
    expect(massage(iterateEmojis("⌚"))).toEqual(["\u{231A}"]);
});

test("does not find emojis with default text rendering", () => {
    {
        const string = "☹";
        expect(string).toEqual("\u{2639}");
        expect(massage(iterateEmojis(string))).toEqual([]);
    }

    {
        const string = "↔";
        expect(string).toEqual("\u{2194}");
        expect(massage(iterateEmojis(string))).toEqual([]);
    }
});

test("does not find emojis with explicit text rendering", () => {
    {
        const string = "☹︎";
        expect(string).toEqual("\u{2639}\u{FE0E}");
        expect(massage(iterateEmojis(string))).toEqual([]);
    }

    {
        const string = "↔︎";
        expect(string).toEqual("\u{2194}\u{FE0E}");
        expect(massage(iterateEmojis(string))).toEqual([]);
    }

    {
        const string = "⌚︎";
        expect(string).toEqual("\u{231A}\u{FE0E}");
        expect(massage(iterateEmojis(string))).toEqual([]);
    }
});

test("finds emojis with explicit emoji rendering", () => {
    {
        const string = "☹️";
        expect(string).toEqual("\u{2639}\u{FE0F}");
        expect(massage(iterateEmojis(string))).toEqual(["\u{2639}\u{FE0F}"]);
    }

    {
        const string = "↔️";
        expect(string).toEqual("\u{2194}\u{FE0F}");
        expect(massage(iterateEmojis(string))).toEqual(["\u{2194}\u{FE0F}"]);
    }

    {
        const string = "⌚️";
        expect(string).toEqual("\u{231A}\u{FE0F}");
        expect(massage(iterateEmojis(string))).toEqual(["\u{231A}\u{FE0F}"]);
    }
});

test("finds multiple emojis", () => {
    const string = "😂😂💯";
    expect(string).toEqual("\u{1F602}\u{1F602}\u{1F4AF}");
    expect(massage(iterateEmojis(string))).toEqual(["\u{1F602}", "\u{1F602}", "\u{1F4AF}"]);
});
