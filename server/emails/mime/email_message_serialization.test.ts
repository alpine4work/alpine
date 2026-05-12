import {deserializeMimeStringToEmailMessage} from "~/server/emails/mime/deserialize_mime_string_to_email_message.js";
import {serializeEmailMessageToMimeString} from "~/server/emails/mime/serialize_email_message_to_mime_string.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {RandomId, generateId} from "~/shared/id/id.js";

const aliceEmailAddress = validateEmailAddress("alice@example.com");
const bobEmailAddress = validateEmailAddress("bob@example.com");
const carolEmailAddress = validateEmailAddress("carol@example.com");
const daveEmailAddress = validateEmailAddress("dave@example.com");
const auditEmailAddress = validateEmailAddress("audit@example.com");

const plainTextMessage = {
    id: generateId<RandomId>(),
    from: aliceEmailAddress,
    to: [bobEmailAddress],
    subject: "Plain text test",
    body: {text: "Hello Bob,\n\nThis is a plain text message.\n\nAlice"},
    headers: [],
    attachments: [],
};

const htmlMessage = {
    id: generateId<RandomId>(),
    from: aliceEmailAddress,
    to: [bobEmailAddress, carolEmailAddress],
    cc: [daveEmailAddress],
    subject: "HTML test",
    body: {
        text: "Hello, this is the plain text version.",
        html: "<p>Hello, this is the <strong>HTML</strong> version.</p>",
    },
    headers: [],
    attachments: [],
};

const attachmentMessage = {
    id: generateId<RandomId>(),
    from: aliceEmailAddress,
    to: [bobEmailAddress],
    bcc: [auditEmailAddress],
    subject: "Attachment test",
    body: {text: "Please find the attachment."},
    headers: [{name: "X-Custom-Header", value: "custom-value"}],
    attachments: [
        {
            filename: "report.txt",
            content: new TextEncoder().encode("Report line 1\nReport line 2\n"),
            contentType: "text/plain",
            size: 28,
        },
    ],
};

const fullMessage = {
    id: generateId<RandomId>(),
    from: aliceEmailAddress,
    to: [bobEmailAddress],
    cc: [carolEmailAddress],
    bcc: [daveEmailAddress],
    replyTo: [aliceEmailAddress],
    subject: "Full message test with all headers",
    body: {
        text: "Plain text version.",
        html: "<p>HTML version.</p>",
    },
    headers: [{name: "X-Roundtrip-Custom", value: "preserved-value"}],
    attachments: [
        {
            filename: "image.png",
            content: new TextEncoder().encode("Test data"),
            contentType: "image/png",
            size: 9,
        },
    ],
};

const unicodeMessage = {
    id: generateId<RandomId>(),
    from: aliceEmailAddress,
    to: [bobEmailAddress],
    subject: "会議のご案内: Q2 résumé 🎉",
    body: {text: "Hi."},
    headers: [{name: "X-Title", value: "Ünïcödé välüé"}],
    attachments: [],
};

describe("email message serialization to and from MIME string round-trip", () => {
    test("plain text message", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(plainTextMessage),
        );
        expect(result).toMatchObject({
            from: plainTextMessage.from,
            to: plainTextMessage.to,
            subject: plainTextMessage.subject,
            body: {text: plainTextMessage.body.text},
        });
    });

    test("html + plain text message preserves both body parts", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(htmlMessage),
        );
        expect(result).toMatchObject({
            from: htmlMessage.from,
            to: htmlMessage.to,
            cc: htmlMessage.cc,
            subject: htmlMessage.subject,
            body: {text: htmlMessage.body.text, html: htmlMessage.body.html},
        });
    });

    test("message with attachment preserves attachment content and metadata", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(attachmentMessage),
        );
        expect(result).toMatchObject({
            from: attachmentMessage.from,
            to: attachmentMessage.to,
            subject: attachmentMessage.subject,
            body: {text: attachmentMessage.body.text},
        });
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]).toMatchObject({
            filename: "report.txt",
            contentType: "text/plain",
        });
        expect(result.attachments[0]!.content).toEqual(attachmentMessage.attachments[0]!.content);
    });

    test("html message with attachment preserves all parts", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(fullMessage),
        );
        expect(result).toMatchObject({
            from: fullMessage.from,
            to: fullMessage.to,
            cc: fullMessage.cc,
            bcc: fullMessage.bcc,
            replyTo: fullMessage.replyTo,
            subject: fullMessage.subject,
            headers: [{name: "x-roundtrip-custom", value: "preserved-value"}],
            body: {text: fullMessage.body.text, html: fullMessage.body.html},
        });
        expect(result.attachments).toHaveLength(1);
        expect(result.attachments[0]!.content).toEqual(fullMessage.attachments[0]!.content);
    });

    test("extra headers are preserved", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(attachmentMessage),
        );
        expect(result.headers).toContainEqual({
            name: "x-custom-header",
            value: "custom-value",
        });
    });

    test("unicode subject is preserved", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(unicodeMessage),
        );
        expect(result.subject).toBe(unicodeMessage.subject);
    });

    test("unicode extra header value is preserved", () => {
        const result = deserializeMimeStringToEmailMessage(
            serializeEmailMessageToMimeString(unicodeMessage),
        );
        expect(result.headers).toContainEqual({name: "x-title", value: "Ünïcödé välüé"});
    });
});
