import {encodeStringAsQWord} from "~/server/emails/mime/encode_string_as_q_word.js";

describe("encodeStringAsMimeQWord", () => {
    test("passes through plain ASCII unchanged", () => {
        expect(encodeStringAsQWord("Hello World")).toBe("Hello World");
    });

    test("encodes a non-ASCII character", () => {
        expect(encodeStringAsQWord("café")).toBe("=?UTF-8?Q?caf=C3=A9?=");
    });

    test("encodes a string that is entirely non-ASCII", () => {
        expect(encodeStringAsQWord("日本語")).toBe("=?UTF-8?Q?=E6=97=A5=E6=9C=AC=E8=AA=9E?=");
    });

    test("encodes spaces as underscores inside an encoded word", () => {
        expect(encodeStringAsQWord("hello wörld")).toBe("=?UTF-8?Q?hello_w=C3=B6rld?=");
    });

    test("encodes = and ? which are reserved in Q-encoding", () => {
        expect(encodeStringAsQWord("a=b?c")).toBe("=?UTF-8?Q?a=3Db=3Fc?=");
    });

    test("splits into multiple encoded words when payload exceeds 57 chars", () => {
        // 20 × "é" = 20 × 4 encoded chars = 80 chars, exceeds the 57-char payload limit.
        const input = "é".repeat(20);
        const encoded = encodeStringAsQWord(input);
        expect(encoded).toContain(" ");
        for (const word of encoded.split(" ")) {
            expect(word.length).toBeLessThanOrEqual(75);
        }
    });
});
