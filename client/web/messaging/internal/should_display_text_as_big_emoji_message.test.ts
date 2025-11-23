import {shouldDisplayTextAsBigEmojiMessage} from "~/client/web/messaging/internal/should_display_text_as_big_emoji_message.js";

test("empty string is not treated as big emoji message", () => {
    const string = "";
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
});

test("string with only space is not treated as big emoji message", () => {
    const string = " ";
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
});

test("string with non-emoji characters is not treated as big emoji message", () => {
    const string = "test";
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
});

test("string that ends with non-emoji characters is not treated as big emoji message", () => {
    const string = "test👩";
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
});

test("string that starts with non-emoji characters is not treated as big emoji message", () => {
    const string = "👩test";
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
});

test("single code point emoji is treated as big emoji message", () => {
    const string = "👩";
    expect(string).toEqual("\u{1F469}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("modified emoji is treated as big emoji message", () => {
    const string = "👩🏿";
    expect(string).toEqual("\u{1F469}\u{1F3FF}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("emoji joined together is treated as big emoji message", () => {
    const string = "👨‍👩‍👧‍👧";
    expect(string).toEqual("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F467}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("emoji with default emoji rendering is treated as big emoji message", () => {
    {
        const string = "😂";
        expect(string).toEqual("\u{1F602}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
    }

    {
        const string = "⌚";
        expect(string).toEqual("\u{231A}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
    }
});

test("emoji with default text rendering is not treated as big emoji message", () => {
    {
        const string = "☹";
        expect(string).toEqual("\u{2639}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
    }

    {
        const string = "↔";
        expect(string).toEqual("\u{2194}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
    }
});

test("emoji with explicit text rendering is not treated as big emoji message", () => {
    {
        const string = "☹︎";
        expect(string).toEqual("\u{2639}\u{FE0E}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
    }

    {
        const string = "↔︎";
        expect(string).toEqual("\u{2194}\u{FE0E}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
    }

    {
        const string = "⌚︎";
        expect(string).toEqual("\u{231A}\u{FE0E}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(false);
    }
});

test("emoji with explicit emoji rendering is treated as big emoji message", () => {
    {
        const string = "☹️";
        expect(string).toEqual("\u{2639}\u{FE0F}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
    }

    {
        const string = "↔️";
        expect(string).toEqual("\u{2194}\u{FE0F}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
    }

    {
        const string = "⌚️";
        expect(string).toEqual("\u{231A}\u{FE0F}");
        expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
    }
});

test("multiple emojis are treated as big emoji message", () => {
    const string = "😂😂💯";
    expect(string).toEqual("\u{1F602}\u{1F602}\u{1F4AF}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("multiple emojis with spaces between are treated as big emoji message", () => {
    const string = "😂 😂  💯";
    expect(string).toEqual("\u{1F602} \u{1F602}  \u{1F4AF}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("emoji string can start with space and is treated as big emoji message", () => {
    const string = " 😂";
    expect(string).toEqual(" \u{1F602}");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});

test("emoji string can end with space and is treated as big emoji message", () => {
    const string = "😂 ";
    expect(string).toEqual("\u{1F602} ");
    expect(shouldDisplayTextAsBigEmojiMessage(string)).toEqual(true);
});
