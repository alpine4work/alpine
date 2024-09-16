import {
    canonicalizeFileContentTypeIfExists,
    fileContentTypeByCodeBlockLanguageId,
    fileContentTypes,
    getFileAdditionalContentTypesAndExtensionsByContentTypeForTest,
    getFileContentTypePreferredExtension,
    getPathFileContentTypeIfExists,
    normalizeContentType,
} from "~/shared/files/file_content_type.js";

const fileAdditionalContentTypesAndExtensionsByContentType =
    getFileAdditionalContentTypesAndExtensionsByContentTypeForTest();

test("can normalize content type", () => {
    expect(normalizeContentType("text/html")).toEqual("text/html");
    expect(normalizeContentType("Text/HTML")).toEqual("text/html");
    expect(normalizeContentType('Text/HTML;Charset="utf-8"')).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType('Text/HTML;Charset="UTF-8"')).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("text/html; charset=UTF-8")).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("text/html;   charset=UTF-8")).toEqual("text/html;charset=utf-8");
    expect(normalizeContentType("multipart/form-data; boundary=ExampleBoundaryString")).toEqual(
        "multipart/form-data;boundary=ExampleBoundaryString",
    );
    expect(normalizeContentType('multipart/form-data; boundary="ExampleBoundaryString"')).toEqual(
        "multipart/form-data;boundary=ExampleBoundaryString",
    );
});

test("can canonicalize content type", () => {
    expect(canonicalizeFileContentTypeIfExists("text/html")).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists("Text/HTML")).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists('Text/HTML;Charset="utf-8"')).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists('Text/HTML;Charset="UTF-8"')).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists("text/html; charset=UTF-8")).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists("text/html;   charset=UTF-8")).toEqual("text/html");
    expect(canonicalizeFileContentTypeIfExists("application/msword")).toEqual("application/msword");
    expect(canonicalizeFileContentTypeIfExists("application/vnd.ms-word")).toEqual(
        "application/msword",
    );
    expect(canonicalizeFileContentTypeIfExists("Application/Vnd.Ms-Word")).toEqual(
        "application/msword",
    );
    expect(canonicalizeFileContentTypeIfExists("Application/vnd.ms-word  ")).toEqual(
        "application/msword",
    );
    expect(canonicalizeFileContentTypeIfExists("  Application/vnd.ms-word")).toEqual(
        "application/msword",
    );
    expect(canonicalizeFileContentTypeIfExists("image/heif")).toEqual("image/heif");
    expect(canonicalizeFileContentTypeIfExists("image/heic")).toEqual("image/heif");
    expect(canonicalizeFileContentTypeIfExists("image/heif-sequence")).toEqual("image/heif");
    expect(canonicalizeFileContentTypeIfExists("image/heic-sequence")).toEqual("image/heif");
    expect(canonicalizeFileContentTypeIfExists("multipart/form-data")).toEqual(null);
    expect(
        canonicalizeFileContentTypeIfExists("multipart/form-data; boundary=ExampleBoundaryString"),
    ).toEqual(null);
});

test("all file content types are normalized", () => {
    for (const contentType of fileContentTypes) {
        expect(normalizeContentType(contentType)).toEqual(contentType);
    }
});

test("file content type preferred extensions are lower case", () => {
    for (const contentType of fileContentTypes) {
        const extension = getFileContentTypePreferredExtension(contentType);
        expect(extension.toLowerCase()).toEqual(extension);
        expect(extension).not.toMatch(/\./);
    }
});

test("file content type additional extensions are lower case", () => {
    for (const {extensions} of Object.values(
        fileAdditionalContentTypesAndExtensionsByContentType,
    )) {
        for (const extension of extensions ?? []) {
            expect(extension.toLowerCase()).toEqual(extension);
            expect(extension).not.toMatch(/\./);
        }
    }
});

test("file content type additional content types are normalized", () => {
    for (const {contentTypes} of Object.values(
        fileAdditionalContentTypesAndExtensionsByContentType,
    )) {
        for (const contentType of contentTypes ?? []) {
            expect(normalizeContentType(contentType)).toEqual(contentType);
        }
    }
});

test("file content type extensions (additional and preferred) are unique", () => {
    const extensions = [];

    for (const contentType of fileContentTypes) {
        extensions.push(getFileContentTypePreferredExtension(contentType));
    }

    for (const {extensions: additionalExtensions} of Object.values(
        fileAdditionalContentTypesAndExtensionsByContentType,
    )) {
        for (const extension of additionalExtensions ?? []) {
            extensions.push(extension);
        }
    }

    expect(extensions.length).toBeGreaterThan(fileContentTypes.size);
    expect(Array.from(new Set(extensions))).toEqual(extensions);
});

test("file content types (including additional) are unique", () => {
    const contentTypes = [];

    for (const contentType of fileContentTypes) {
        contentTypes.push(contentType);
    }

    for (const {contentTypes: additionalContentTypes} of Object.values(
        fileAdditionalContentTypesAndExtensionsByContentType,
    )) {
        for (const contentType of additionalContentTypes ?? []) {
            contentTypes.push(contentType);
        }
    }

    expect(contentTypes.length).toBeGreaterThan(fileContentTypes.size);
    expect(Array.from(new Set(contentTypes))).toEqual(contentTypes);
});

test("file code block language content types are unique", () => {
    const contentTypes = [];

    for (const contentType of Object.values(fileContentTypeByCodeBlockLanguageId)) {
        contentTypes.push(contentType);
    }

    expect(Array.from(new Set(contentTypes))).toEqual(contentTypes);
});

test("can get content type based on a file extension", () => {
    expect(getPathFileContentTypeIfExists("test.jpeg")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.jpg")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.JPEG")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.JPG")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.Jpeg")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.Jpg")).toEqual("image/jpeg");
    expect(getPathFileContentTypeIfExists("test.ts")).toEqual("text/x-typescript");
    expect(getPathFileContentTypeIfExists("test.tsx")).toEqual("text/x-typescript");
    expect(getPathFileContentTypeIfExists("entry.client.tsx")).toEqual("text/x-typescript");
});
