import {deserializeMimeStringToEmailMessage} from "~/server/emails/mime/deserialize_mime_string_to_email_message.js";
import {CRLF} from "~/server/emails/mime/mime_constants.js";

function buildMime(lines: Array<string>): string {
    return lines.join(CRLF);
}

// Base64 values used in tests below: "Hello." -> SGVsbG8u "Hi." -> SGku
// "<p>Hi.</p>" -> PHA+SGkuPC9wPg== "data" -> ZGF0YQ==

describe("parseMimeEmailMessage", () => {
    test("parses plain text message", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Hello",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGVsbG8u",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);

        expect(result).toMatchObject({
            from: "alice@test.cyberworlds.dev",
            to: ["bob@test.cyberworlds.dev"],
            cc: [],
            bcc: [],
            subject: "Hello",
            body: {text: "Hello."},
        });
        expect(result.body.html).toBeUndefined();
    });

    test("parses multiple To addresses", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev, carol@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.to).toEqual(["bob@test.cyberworlds.dev", "carol@test.cyberworlds.dev"]);
    });

    test("parses Cc and Bcc headers", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Cc: carol@test.cyberworlds.dev",
            "Bcc: dave@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.cc).toEqual(["carol@test.cyberworlds.dev"]);
        expect(result.bcc).toEqual(["dave@test.cyberworlds.dev"]);
    });

    test("parses single Reply-To address", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Reply-To: carol@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.replyTo).toEqual(["carol@test.cyberworlds.dev"]);
    });

    test("parses multiple Reply-To addresses", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Reply-To: "Carol Example" <carol@test.cyberworlds.dev>, <dave@test.cyberworlds.dev>`,
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.replyTo).toEqual(["carol@test.cyberworlds.dev", "dave@test.cyberworlds.dev"]);
    });
    test("decodes Q-encoded subject", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: =?UTF-8?Q?caf=C3=A9?=",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        expect(deserializeMimeStringToEmailMessage(mime).subject).toBe("café");
    });

    test("passes through plain ASCII subject unchanged", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Plain subject",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        expect(deserializeMimeStringToEmailMessage(mime).subject).toBe("Plain subject");
    });

    test("parses extra headers and decodes Q-encoded values", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "X-Plain: plain-value",
            "X-Unicode: =?UTF-8?Q?r=C3=A9sum=C3=A9?=",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.headers).toContainEqual({name: "x-plain", value: "plain-value"});
        expect(result.headers).toContainEqual({name: "x-unicode", value: "résumé"});
    });

    test("reserved headers are not included in extra headers", () => {
        const mime = buildMime([
            "Date: Wed, 06 May 2026 10:00:00 +0000",
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "Message-ID: <abc123@test.cyberworlds.dev>",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        const names = result.headers.map(h => h.name);
        expect(names).not.toContain("date");
        expect(names).not.toContain("from");
        expect(names).not.toContain("to");
        expect(names).not.toContain("subject");
        expect(names).not.toContain("message-id");
        expect(names).not.toContain("mime-version");
        expect(names).not.toContain("content-type");
        expect(names).not.toContain("content-transfer-encoding");
        expect(names).not.toContain("reply-to");
        expect(names).not.toContain("x-alpine-message-id");
    });

    test("throws when top-level Content-Type is not supported", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: application/json",
            "",
            "{}",
        ]);

        expect(() => deserializeMimeStringToEmailMessage(mime)).toThrow(
            "Unsupported MIME content type: application/json",
        );
    });

    test("unfolds folded custom header lines into a single extra header value", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "X-Folded: first segment",
            " second segment",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        expect(deserializeMimeStringToEmailMessage(mime).headers).toContainEqual({
            name: "x-folded",
            value: "first segment second segment",
        });
    });

    test("parses top-level text/html body without a plain text alternative", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toEqual({text: "", html: "<p>Hi.</p>"});
    });

    test("parses multipart/related as a body with inline parts treated as attachments", () => {
        const outerBoundary = "related-boundary";
        const innerBoundary = "alt-boundary";
        // Simulates an HTML email with an inline image, structured as: multipart/related
        // multipart/alternative text/plain text/html image/png (inline image)
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/related; boundary="${outerBoundary}"`,
            "",
            `--${outerBoundary}`,
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
            "",
            `--${innerBoundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${innerBoundary}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
            `--${innerBoundary}--`,
            `--${outerBoundary}`,
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            "Content-Disposition: inline",
            "Content-ID: <logo@test.cyberworlds.dev>",
            "",
            "ZGF0YQ==",
            `--${outerBoundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toMatchObject({text: "Hi.", html: "<p>Hi.</p>"});
    });

    test("parses multipart/related when outer closing boundary is omitted", () => {
        const outerBoundary = "related-truncated";
        const innerBoundary = "alt-truncated";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/related; boundary="${outerBoundary}"`,
            "",
            `--${outerBoundary}`,
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
            "",
            `--${innerBoundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${innerBoundary}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
            `--${innerBoundary}--`,
            `--${outerBoundary}`,
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            "Content-Disposition: inline",
            "",
            "ZGF0YQ==",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toMatchObject({text: "Hi.", html: "<p>Hi.</p>"});
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("data"));
    });

    test("parses multipart/alternative with plain text and html", () => {
        const boundary = "test-boundary";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
            `--${boundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toMatchObject({text: "Hi.", html: "<p>Hi.</p>"});
    });

    test("parses multipart/alternative when closing boundary is omitted", () => {
        const boundary = "test-boundary";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toMatchObject({text: "Hi.", html: "<p>Hi.</p>"});
    });

    test("parses multipart/mixed with plain text and attachment", () => {
        const boundary = "outer";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            `Content-Type: text/plain; name="file.txt"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="file.txt"`,
            "",
            "ZGF0YQ==",
            `--${boundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body.text).toBe("Hi.");
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]).toMatchObject({
            filename: "file.txt",
            contentType: "text/plain",
        });
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("data"));
    });

    test("parses multipart/mixed when final closing boundary is omitted", () => {
        const boundary = "outer-truncated";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            `Content-Type: text/plain; name="file.txt"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="file.txt"`,
            "",
            "ZGF0YQ==",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body.text).toBe("Hi.");
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]!.filename).toBe("file.txt");
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("data"));
    });

    test("parses attachment without Content-Disposition when Content-Type has name=", () => {
        const boundary = "outer";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            'Content-Type: image/png; name="pixel.png"',
            "Content-Transfer-Encoding: base64",
            "",
            "ZGF0YQ==",
            `--${boundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]).toMatchObject({
            filename: "pixel.png",
            contentType: "image/png",
        });
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("data"));
    });

    test("parses attachment filename for extended parameter filename*", () => {
        const boundary = "outer";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            `Content-Type: text/plain; name="ignored.txt"`,
            "Content-Transfer-Encoding: base64",
            // eslint-disable-next-line cyberworlds/string-quotes
            "Content-Disposition: attachment; filename=\"old.txt\"; filename*=UTF-8''new%20name.txt",
            "",
            "ZGF0YQ==",
            `--${boundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.attachments[0]!.filename).toBe("new name.txt");
    });

    test("decodes quoted-printable attachment body as raw octets", () => {
        const boundary = "outer";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            "Content-Type: application/octet-stream",
            "Content-Transfer-Encoding: quoted-printable",
            `Content-Disposition: attachment; filename="b.bin"`,
            "",
            "=00=FF=0A",
            `--${boundary}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.attachments[0]!.content).toEqual(new Uint8Array([0, 255, 10]));
    });

    test("decodes base64 attachment body split across multiple lines", () => {
        const boundary = "outer";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${boundary}`,
            `Content-Type: text/plain; name="file.txt"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="file.txt"`,
            "",
            "ZGF0",
            "YQ==",
            `--${boundary}--`,
        ]);

        expect(deserializeMimeStringToEmailMessage(mime).attachments[0]!.content).toEqual(
            new TextEncoder().encode("data"),
        );
    });

    test("parses multipart/mixed wrapping multipart/alternative with attachment", () => {
        const outer = "outer-boundary";
        const inner = "inner-boundary";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${outer}"`,
            "",
            `--${outer}`,
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/alternative; boundary="${inner}"`,
            "",
            `--${inner}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
            `--${inner}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "PHA+SGkuPC9wPg==",
            `--${inner}--`,
            `--${outer}`,
            `Content-Type: text/plain; name="file.txt"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="file.txt"`,
            "",
            "ZGF0YQ==",
            `--${outer}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.body).toMatchObject({text: "Hi.", html: "<p>Hi.</p>"});
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("data"));
    });

    test("parses nested multipart/mixed inside multipart/mixed", () => {
        const outer = "outer-nested-mixed";
        const inner = "inner-nested-mixed";
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Nested multipart",
            "MIME-Version: 1.0",
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${outer}"`,
            "",
            `--${outer}`,
            // eslint-disable-next-line cyberworlds/string-quotes
            `Content-Type: multipart/mixed; boundary="${inner}"`,
            "",
            `--${inner}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGVsbG8u",
            `--${inner}`,
            `Content-Type: application/octet-stream; name="inner.bin"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="inner.bin"`,
            "",
            "aW5uZXI=",
            `--${inner}--`,
            `--${outer}`,
            `Content-Type: application/octet-stream; name="root.bin"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="root.bin"`,
            "",
            "cm9vdA==",
            `--${outer}--`,
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result).toMatchObject({
            body: {text: "Hello."},
            attachments: [
                {
                    filename: "inner.bin",
                    contentType: "application/octet-stream",
                    size: 5,
                },
                {
                    filename: "root.bin",
                    contentType: "application/octet-stream",
                    size: 4,
                },
            ],
        });
        expect(result.attachments[0]!.content).toEqual(new TextEncoder().encode("inner"));
        expect(result.attachments[1]!.content).toEqual(new TextEncoder().encode("root"));
    });

    test("handles LF line endings as well as CRLF", () => {
        const mime = [
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Hello",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGVsbG8u",
        ].join("\n");

        expect(deserializeMimeStringToEmailMessage(mime).body.text).toBe("Hello.");
    });

    test("handles base64 body split across multiple lines", () => {
        // "Hello." = SGVsbG8u — split it artificially across lines.
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGVs",
            "bG8u",
        ]);

        expect(deserializeMimeStringToEmailMessage(mime).body.text).toBe("Hello.");
    });

    test("parses From and To with display names and angle addresses", () => {
        const mime = buildMime([
            "From: Alice Example <alice@test.cyberworlds.dev>",
            "To: Bob Builder <bob@test.cyberworlds.dev>, carol@test.cyberworlds.dev",
            "Subject: Hello",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.from).toBe("alice@test.cyberworlds.dev");
        expect(result.to).toEqual(["bob@test.cyberworlds.dev", "carol@test.cyberworlds.dev"]);
    });

    test("parses RFC 2047 encoded display name before angle address", () => {
        const mime = buildMime([
            "From: =?UTF-8?Q?Caf=C3=A9?= Owner <owner@test.cyberworlds.dev>",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.from).toBe("owner@test.cyberworlds.dev");
    });

    test("parses To with quoted display name containing a comma", () => {
        const mime = buildMime([
            "From: alice@test.cyberworlds.dev",
            // eslint-disable-next-line cyberworlds/string-quotes -- RFC 5322 To header fixture
            `To: "Doe, Jane" <jane@test.cyberworlds.dev>, bob@test.cyberworlds.dev`,
            "Subject: Test",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            "SGku",
        ]);

        const result = deserializeMimeStringToEmailMessage(mime);
        expect(result.to).toEqual(["jane@test.cyberworlds.dev", "bob@test.cyberworlds.dev"]);
    });
});
