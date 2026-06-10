import {getAttachmentFilenameFromMimeHeaders} from "~/server/emails/mime/get_attachment_filename_from_mime_headers.js";

// eslint-disable-next-line cyberworlds/string-quotes
const asciiSingleQuote = "'";

describe("getAttachmentFilenameFromMimeHeaders", () => {
    test("prefers extended parameter filename* over plain filename", () => {
        const filenameStarValue = `UTF-8${asciiSingleQuote}${asciiSingleQuote}new%20file.bin`;
        expect(
            getAttachmentFilenameFromMimeHeaders(
                "application/octet-stream",
                `attachment; filename="legacy.bin"; filename*=${filenameStarValue}`,
            ),
        ).toBe("new file.bin");
    });

    test("falls back to plain filename when filename* is absent", () => {
        expect(
            getAttachmentFilenameFromMimeHeaders(
                "application/octet-stream",
                'attachment; filename="report.pdf"',
            ),
        ).toBe("report.pdf");
    });

    test("uses name* on Content-Type when Content-Disposition has no filename", () => {
        const nameStarValue = `UTF-8${asciiSingleQuote}${asciiSingleQuote}doc%2Etxt`;
        expect(
            getAttachmentFilenameFromMimeHeaders(
                `application/octet-stream; name*=${nameStarValue}`,
                "inline",
            ),
        ).toBe("doc.txt");
    });

    test("assembles multi-segment continuation filename*0* filename*1* per RFC 2231", () => {
        // "very" = 76657279, "long" = 6C6F6E67 — split across two segments
        const segment0 = `UTF-8${asciiSingleQuote}${asciiSingleQuote}very%20`;
        const segment1 = `long%20name.bin`;
        expect(
            getAttachmentFilenameFromMimeHeaders(
                "application/octet-stream",
                `attachment; filename*0*=${segment0}; filename*1*=${segment1}`,
            ),
        ).toBe("very long name.bin");
    });

    test("assembles mixed continuation with starred and unstarred segments per RFC 2231", () => {
        const segment0 = `UTF-8${asciiSingleQuote}${asciiSingleQuote}part1%20`;
        // Unstarred segment — value is a plain string, no percent-encoding
        const segment1 = `part2.txt`;
        expect(
            getAttachmentFilenameFromMimeHeaders(
                "application/octet-stream",
                `attachment; filename*0*=${segment0}; filename*1=${segment1}`,
            ),
        ).toBe("part1 part2.txt");
    });
});
