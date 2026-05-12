import {encodeStringAsQuotedPrintable} from "~/server/emails/mime/encode_string_as_quoted_printable.js";
import {CRLF} from "~/server/emails/mime/mime_constants.js";

describe("encodeStringAsQuotedPrintable", () => {
    test("encodes equals sign as =3D", () => {
        expect(encodeStringAsQuotedPrintable("a=b")).toBe("a=3Db");
    });

    test("encodes space and tab as hex escapes", () => {
        expect(encodeStringAsQuotedPrintable("a b")).toBe("a=20b");
        expect(encodeStringAsQuotedPrintable("a\tb")).toBe("a=09b");
    });

    test("encodes UTF-8 octets for non-ASCII", () => {
        expect(encodeStringAsQuotedPrintable("café")).toBe("caf=C3=A9");
    });

    test("inserts soft line breaks when line would exceed 76 characters", () => {
        const input = "a".repeat(80);
        const encoded = encodeStringAsQuotedPrintable(input);
        expect(encoded).toContain(`=${CRLF}`);
        expect(encoded.replaceAll(`=${CRLF}`, "").length).toBe(80);
    });
});
