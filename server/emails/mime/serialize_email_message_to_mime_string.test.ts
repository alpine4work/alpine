import {CRLF} from "~/server/emails/mime/mime_constants.js";
import {
    encodeAndFormatTextForMime,
    generateBoundary,
    serializeEmailMessageToMimeString,
} from "~/server/emails/mime/serialize_email_message_to_mime_string.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {RandomId, generateId} from "~/shared/id/id.js";

const alice = validateEmailAddress("alice@test.cyberworlds.dev");
const bob = validateEmailAddress("bob@test.cyberworlds.dev");
const carol = validateEmailAddress("carol@test.cyberworlds.dev");
const dave = validateEmailAddress("dave@test.cyberworlds.dev");

const testAttachmentBytes = new TextEncoder().encode("test attachment data");

describe("serializeEmailMessageToMimeString", () => {
    test("base64 body lines are wrapped at 76 characters", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "a".repeat(200)},
            headers: [],
            attachments: [],
        };

        const mime = serializeEmailMessageToMimeString(message);
        for (const line of mime.split(CRLF)) {
            expect(line.length).toBeLessThanOrEqual(76);
        }
    });
    test("Date header uses numeric timezone offset not GMT (RFC 5322 §3.3)", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [],
            attachments: [],
        };

        const mime = serializeEmailMessageToMimeString(message);
        const dateLine = mime.split(CRLF).find(line => line.startsWith("Date:"))!;
        expect(dateLine.startsWith("Date: ")).toBe(true);
        expect(dateLine.endsWith("+0000")).toBe(true);
        expect(dateLine).not.toContain("GMT");
    });

    test("plain text message produces correct headers and base64 body", () => {
        const messageTimestamp = 1_746_000_000_000;
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Hello",
            body: {
                text: "Hi Bob,\n\nJust wanted to share the latest project status. We are on track for the Q2 deadline.\n\nBest,\nAlice",
            },
            headers: [],
            attachments: [],
        };

        const mime = serializeEmailMessageToMimeString(message, {messageTimestamp});
        const lines = mime.split(CRLF);

        expect(lines).toEqual([
            `Date: ${new Date(messageTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Hello",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
        ]);
    });

    test("Cc header is included when present", () => {
        const messageTimestamp = 1_746_000_000_000;
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            cc: [carol],
            subject: "Test",
            body: {
                text: "Hi Bob,\n\nJust wanted to share the latest project status. We are on track for the Q2 deadline.\n\nBest,\nAlice",
            },
            headers: [],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message, {messageTimestamp}).split(CRLF);
        expect(lines).toEqual([
            `Date: ${new Date(messageTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Cc: carol@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            // Body text base64-encoded
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
        ]);
    });

    test("Bcc header is included when present", () => {
        const messageTimestamp = 1_746_000_000_000;
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            bcc: [dave],
            subject: "Test",
            body: {
                text: "Hi Bob,\n\nJust wanted to share the latest project status. We are on track for the Q2 deadline.\n\nBest,\nAlice",
            },
            headers: [],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message, {messageTimestamp}).split(CRLF);
        expect(lines).toEqual([
            `Date: ${new Date(messageTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Bcc: dave@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            // Body text base64-encoded
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
        ]);
    });

    test("Reply-To header is included when present", () => {
        const messageTimestamp = 1_746_000_000_000;
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            replyTo: [carol],
            subject: "Test",
            body: {
                text: "Hi Bob,\n\nJust wanted to share the latest project status. We are on track for the Q2 deadline.\n\nBest,\nAlice",
            },
            headers: [],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message, {messageTimestamp}).split(CRLF);
        expect(lines).toEqual([
            `Date: ${new Date(messageTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Reply-To: carol@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            // Body text base64-encoded
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
        ]);
    });

    test("multiple To addresses are comma-separated", () => {
        const messageTimestamp = 1_746_000_000_000;
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob, carol],
            cc: [],
            bcc: [],
            subject: "Test",
            body: {text: "Hi."},
            headers: [],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message, {messageTimestamp}).split(CRLF);
        expect(lines).toEqual([
            `Date: ${new Date(messageTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev, carol@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            "Content-Type: text/plain; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            // Body text base64-encoded
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
        ]);
    });

    test("non-ASCII subject is Q-encoded", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "café",
            body: {text: "Hi."},
            headers: [],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message).split(CRLF);
        expect(lines).toContain("Subject: =?UTF-8?Q?caf=C3=A9?=");
    });

    test("extra headers are included and non-ASCII values are Q-encoded", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [
                {name: "X-Plain", value: "plain-value"},
                {name: "X-Unicode", value: "résumé"},
            ],
            attachments: [],
        };

        const lines = serializeEmailMessageToMimeString(message).split(CRLF);
        expect(lines).toContain("X-Plain: plain-value");
        expect(lines).toContain("X-Unicode: =?UTF-8?Q?r=C3=A9sum=C3=A9?=");
    });

    test("reserved headers in extra headers are stripped", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [{name: "Content-Type", value: "text/calendar"}],
            attachments: [],
        };

        const mime = serializeEmailMessageToMimeString(message);
        // Should only appear once (from the body part), not from the extra header.
        expect(mime.split("Content-Type:")).toHaveLength(2);
    });

    test("html and plain text message uses multipart/alternative", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {
                text: "# Cyberworlds Test\n\nTest message body",
                html: "<html><body><h1>Cyberworlds Test</h1><p>Test message body</p></body></html>",
            },
            headers: [],
            attachments: [],
        };

        const currentTimestamp = Date.now();
        const boundary = generateBoundary(`boundary_${message.id}_${currentTimestamp}_alternative`);

        const mime = serializeEmailMessageToMimeString(message, {
            messageTimestamp: currentTimestamp,
        });
        const lines = mime.split(CRLF);

        expect(lines).toEqual([
            `Date: ${new Date(currentTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            `Content-Type: text/plain; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            "",
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
            `--${boundary}`,
            `Content-Type: text/html; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            "",
            ...encodeAndFormatTextForMime(message.body.html).split(CRLF),
            `--${boundary}--`,
        ]);
    });

    test("plain text with attachment uses multipart/mixed", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {
                text: "Hi Bob,\n\nJust wanted to share the latest project status. We are on track for the Q2 deadline.\n\nBest,\nAlice",
            },
            headers: [],
            attachments: [
                {
                    filename: "file.txt",
                    content: testAttachmentBytes,
                    contentType: "text/plain",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        const currentTimestamp = Date.now();
        const boundary = generateBoundary(`boundary_${message.id}_${currentTimestamp}_mixed`);

        const mime = serializeEmailMessageToMimeString(message, {
            messageTimestamp: currentTimestamp,
        });
        const lines = mime.split(CRLF);

        expect(lines).toEqual([
            `Date: ${new Date(currentTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            `Content-Type: text/plain; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            "",
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
            `--${boundary}`,
            `Content-Type: text/plain; name="file.txt"`,
            `Content-Transfer-Encoding: base64`,
            'Content-Disposition: attachment; filename="file.txt"',
            "",
            ...encodeAndFormatTextForMime(new TextDecoder().decode(testAttachmentBytes)).split(
                CRLF,
            ),
            `--${boundary}--`,
        ]);
    });

    test("html with attachment uses multipart/mixed wrapping multipart/alternative", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi.", html: "<p>Hi.</p>"},
            headers: [],
            attachments: [
                {
                    filename: "file.txt",
                    content: testAttachmentBytes,
                    contentType: "text/plain",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        const currentTimestamp = Date.now();
        const mixedBoundary = generateBoundary(`boundary_${message.id}_${currentTimestamp}_mixed`);
        const altBoundary = generateBoundary(
            `boundary_${message.id}_${currentTimestamp}_alternative`,
        );

        const mime = serializeEmailMessageToMimeString(message, {
            messageTimestamp: currentTimestamp,
        });
        const lines = mime.split(CRLF);

        expect(lines).toEqual([
            `Date: ${new Date(currentTimestamp).toUTCString().replace("GMT", "+0000")}`,
            "From: alice@test.cyberworlds.dev",
            "To: bob@test.cyberworlds.dev",
            "Subject: Test",
            "MIME-Version: 1.0",
            `Message-ID: <${message.id}@test.cyberworlds.dev>`,
            `X-Alpine-Message-Id: ${message.id}`,
            `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
            "",
            `--${mixedBoundary}`,
            `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
            "",
            `--${altBoundary}`,
            `Content-Type: text/plain; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            "",
            ...encodeAndFormatTextForMime(message.body.text).split(CRLF),
            `--${altBoundary}`,
            `Content-Type: text/html; charset=utf-8`,
            `Content-Transfer-Encoding: base64`,
            "",
            // Body HTML base64-encoded
            ...encodeAndFormatTextForMime(message.body.html).split(CRLF),
            `--${altBoundary}--`,
            `--${mixedBoundary}`,
            `Content-Type: text/plain; name="file.txt"`,
            `Content-Transfer-Encoding: base64`,
            'Content-Disposition: attachment; filename="file.txt"',
            "",
            ...encodeAndFormatTextForMime(new TextDecoder().decode(testAttachmentBytes)).split(
                CRLF,
            ),
            `--${mixedBoundary}--`,
        ]);
    });

    test("throws when plain text contains the multipart mixed boundary", () => {
        const id = generateId<RandomId>();
        const messageTimestamp = 1_705_000_000_000;
        const mixedBoundary = generateBoundary(`boundary_${id}_${messageTimestamp}_mixed`);
        const message = {
            id,
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: `see ${mixedBoundary} in body`},
            headers: [],
            attachments: [
                {
                    filename: "a.txt",
                    content: testAttachmentBytes,
                    contentType: "text/plain",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        expect(() => serializeEmailMessageToMimeString(message, {messageTimestamp})).toThrow(
            "MIME boundary string cannot be present in the message body or attachment names",
        );
    });

    test("throws when an attachment filename contains the multipart mixed boundary", () => {
        const id = generateId<RandomId>();
        const messageTimestamp = 1_705_000_000_001;
        const mixedBoundary = generateBoundary(`boundary_${id}_${messageTimestamp}_mixed`);
        const message = {
            id,
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [],
            attachments: [
                {
                    filename: `${mixedBoundary}.txt`,
                    content: testAttachmentBytes,
                    contentType: "text/plain",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        expect(() => serializeEmailMessageToMimeString(message, {messageTimestamp})).toThrow(
            "MIME boundary string cannot be present in the message body or attachment names",
        );
    });

    test("throws when HTML contains the multipart alternative boundary", () => {
        const id = generateId<RandomId>();
        const messageTimestamp = 1_705_000_000_002;
        const altBoundary = generateBoundary(`boundary_${id}_${messageTimestamp}_alternative`);
        const message = {
            id,
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi.", html: `<p>${altBoundary}</p>`},
            headers: [],
            attachments: [],
        };

        expect(() => serializeEmailMessageToMimeString(message, {messageTimestamp})).toThrow(
            "MIME boundary string cannot be present in the message body or attachment names",
        );
    });

    test("non-ASCII attachment filename is encoded as RFC 2231 extended parameter", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [],
            attachments: [
                {
                    filename: "résumé.pdf",
                    content: testAttachmentBytes,
                    contentType: "application/pdf",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        const mime = serializeEmailMessageToMimeString(message);
        // eslint-disable-next-line cyberworlds/string-quotes -- RFC 2231 charset'language'value separator
        expect(mime).toContain("name*=UTF-8''r%C3%A9sum%C3%A9.pdf");
        // eslint-disable-next-line cyberworlds/string-quotes -- RFC 2231 charset'language'value separator
        expect(mime).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
    });

    test("ASCII attachment filename uses plain quoted parameter", () => {
        const message = {
            id: generateId<RandomId>(),
            from: alice,
            to: [bob],
            subject: "Test",
            body: {text: "Hi."},
            headers: [],
            attachments: [
                {
                    filename: "report.pdf",
                    content: testAttachmentBytes,
                    contentType: "application/pdf",
                    size: testAttachmentBytes.length,
                },
            ],
        };

        const mime = serializeEmailMessageToMimeString(message);
        expect(mime).toContain('name="report.pdf"');
        expect(mime).toContain('filename="report.pdf"');
    });
});
