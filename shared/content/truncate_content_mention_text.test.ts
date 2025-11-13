import {truncateContentMentionText} from "~/shared/content/truncate_content_mention_text.js";

test("`truncateContentMentionText` handles empty string", () => {
    expect(truncateContentMentionText("")).toEqual("");
});

test("`truncateContentMentionText` handles whitespace-only strings", () => {
    expect(truncateContentMentionText("   ")).toEqual("");
    expect(truncateContentMentionText("\t\n  ")).toEqual("");
});

test("`truncateContentMentionText` preserves short strings", () => {
    const shortText = "This is a short message.";
    expect(truncateContentMentionText(shortText)).toEqual(shortText);
});

test("`truncateContentMentionText` handles exactly 100 graphemes", () => {
    const text = "a".repeat(100);
    expect(truncateContentMentionText(text)).toEqual(text);
});

test("`truncateContentMentionText` truncates at whitespace after soft max", () => {
    // Create a string that's 135 chars with a space at position 132
    const text = "a".repeat(131) + " " + "b".repeat(10);
    expect(truncateContentMentionText(text)).toEqual("a".repeat(104) + " […]");
});

test("`truncateContentMentionText` truncates at hard max without whitespace", () => {
    // Create a string that's 150 chars with no spaces after position 130
    const text = "a".repeat(150);
    expect(truncateContentMentionText(text)).toEqual("a".repeat(104) + " […]");
});

test("`truncateContentMentionText` handles strings already ending with truncation suffix", () => {
    const text = "a".repeat(140) + " […]";
    expect(truncateContentMentionText(text)).toEqual("a".repeat(104) + " […]");
});

test("`truncateContentMentionText` handles emojis and unicode characters", () => {
    {
        const text = "Hello 👋 World 🌍 " + "a".repeat(130);
        expect(text.length).toBe(148);
        const result = truncateContentMentionText(text);
        expect(result).toBe("Hello 👋 World 🌍 " + "a".repeat(88) + " […]");
    }

    {
        const text = "Hello 👋 World 👨‍👩‍👧‍👦 " + "a".repeat(130);
        expect(text.length).toBe(157);
        const result = truncateContentMentionText(text);
        expect(result).toBe("Hello 👋 World 👨‍👩‍👧‍👦 " + "a".repeat(88) + " […]");
    }

    {
        const text = "Hello 👋 World 🌍 " + "👨‍👩‍👧‍👦".repeat(130);
        expect(text.length).toBe(1448);
        const result = truncateContentMentionText(text);
        expect(result).toBe("Hello 👋 World 🌍 " + "👨‍👩‍👧‍👦".repeat(88) + " […]");
    }
});

test("`truncateContentMentionText` handles various whitespace characters", () => {
    const text = "a".repeat(131) + "\u00A0" + "b".repeat(10); // non-breaking space
    expect(truncateContentMentionText(text)).toEqual("a".repeat(104) + " […]");

    const textWithTab = "a".repeat(131) + "\t" + "b".repeat(10);
    expect(truncateContentMentionText(textWithTab)).toEqual("a".repeat(104) + " […]");
});
