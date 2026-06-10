import {decodeEncodedWords} from "~/server/emails/mime/decode_encoded_words.js";
import {encodeStringAsQWord} from "~/server/emails/mime/encode_string_as_q_word.js";

describe("decodeEncodedWords", () => {
    test("passes through plain ASCII unchanged", () => {
        expect(decodeEncodedWords("Hello World")).toBe("Hello World");
    });
    test("passes through unknown encoding token verbatim", () => {
        expect(decodeEncodedWords("=?UTF-8?X?abc?=")).toBe("=?UTF-8?X?abc?=");
    });
    describe("Q-encoding", () => {
        test("decodes a single encoded word", () => {
            expect(decodeEncodedWords("=?UTF-8?Q?caf=C3=A9?=")).toBe("café");
        });

        test("decodes underscores as spaces", () => {
            expect(decodeEncodedWords("=?UTF-8?Q?hello_world?=")).toBe("hello world");
        });

        test("decodes adjacent encoded words and collapses whitespace between them", () => {
            expect(decodeEncodedWords("=?UTF-8?Q?foo?= =?UTF-8?Q?bar?=")).toBe("foobar");
        });

        test("preserves literal text surrounding encoded words", () => {
            expect(decodeEncodedWords("Re: =?UTF-8?Q?caf=C3=A9?= update")).toBe("Re: café update");
        });

        test("decodes Q-encoded ISO-8859-1 octets", () => {
            expect(decodeEncodedWords("=?ISO-8859-1?Q?=E9?=")).toBe("é");
        });
    });
    describe("B-encoding", () => {
        test("decodes B-encoded UTF-8 payload", () => {
            expect(decodeEncodedWords("=?UTF-8?B?Y2Fmw6k=?=")).toBe("café");
        });

        test("decodes B-encoded payload with line breaks inside base64", () => {
            expect(decodeEncodedWords("=?UTF-8?B?Y2Fm\r\nw6k=?=")).toBe("café");
        });
    });
});

describe("decodeRfc2047EncodedWordsInHeaderValueToString", () => {
    test("matches decodeEncodedWords for Q word", () => {
        const s = "=?UTF-8?Q?caf=C3=A9?=";
        expect(decodeEncodedWords(s)).toBe("café"); // Should decode to the actual string
    });
});

describe("encodeStringAsQWord and decodeEncodedWords round-trip", () => {
    const cases = [
        "plain ASCII",
        "café",
        "日本語",
        "hello wörld",
        "Subject with emoji 🎉",
        "Ünïcödé héädér",
        "a=b?c",
        "é".repeat(20),
    ];

    for (const input of cases) {
        test(`${JSON.stringify(input)} round-trips`, () => {
            expect(decodeEncodedWords(encodeStringAsQWord(input))).toBe(input);
        });
    }
});
