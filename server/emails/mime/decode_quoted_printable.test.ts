import {
    decodeQuotedPrintable,
    decodeQuotedPrintableToBytes,
} from "~/server/emails/mime/decode_quoted_printable.js";
import {encodeStringAsQuotedPrintable} from "~/server/emails/mime/encode_string_as_quoted_printable.js";
import {CRLF} from "~/server/emails/mime/mime_constants.js";

describe("decodeQuotedPrintableToUint8Array", () => {
    test("returns raw octets for hex escapes without applying a charset", () => {
        expect([...decodeQuotedPrintableToBytes("caf=C3=A9")]).toEqual([
            0x63, 0x61, 0x66, 0xc3, 0xa9,
        ]);
    });
});

describe("decodeQuotedPrintable", () => {
    test("decodes UTF-8 octets when charset is utf-8", () => {
        expect(decodeQuotedPrintable("caf=C3=A9", "utf-8")).toBe("café");
    });

    test("drops soft line breaks and decodes UTF-8", () => {
        expect(decodeQuotedPrintable(`caf=C3=A9=${CRLF}caf=C3=A9`, "utf-8")).toBe("cafécafé");
    });

    test("decodes Latin-1 octets when charset is iso-8859-1", () => {
        expect(decodeQuotedPrintable("caf=E9", "iso-8859-1")).toBe("café");
    });

    test("throws on incomplete escape at end", () => {
        expect(() => decodeQuotedPrintable("ab=", "utf-8")).toThrow(
            "Invalid quoted-printable: expected two hex digits or a soft line break after the equals sign",
        );
    });

    test("throws on non-hex after equals", () => {
        expect(() => decodeQuotedPrintable("=GG", "utf-8")).toThrow(
            "Invalid quoted-printable: expected two hex digits or a soft line break after the equals sign",
        );
    });

    test("throws on non-ASCII literal outside escape", () => {
        expect(() => decodeQuotedPrintable("caf\u00e9", "utf-8")).toThrow(
            "Invalid quoted-printable: non-ASCII character outside of =XX escape",
        );
    });

    test.each([["plain"], ["a=b?c"], ["café"], ["line\nbreak"], ["x".repeat(200)]])(
        "round-trips encode output when charset is utf-8 (%#)",
        input => {
            expect(decodeQuotedPrintable(encodeStringAsQuotedPrintable(input), "utf-8")).toBe(
                input,
            );
        },
    );
});
