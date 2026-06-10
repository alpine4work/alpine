import {
    getFilePreviewSize,
    getFilePreviewSizeForLayout,
} from "~/shared/content/get_file_preview_size.js";
import {contentLargeFallbackFileWidthPx} from "~/shared/design/core/content_shared_styles.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

const largeFallbackWidth = contentLargeFallbackFileWidthPx;
const spaceId = generateId<SpaceId>();

const placeholder = new FileImagePreviewPlaceholder([
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
    [
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
        {r: 255, g: 0, b: 0},
    ],
]);

const codeContent = new FileCodePreviewContent([
    {type: "String", classes: "tok-keyword", string: "let"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName tok-definition", string: "x"},
]);

function createFileModelData(
    overrides: Partial<FileModelData> & Pick<FileModelData, "preview">,
): FileModelData {
    return {
        id: generateChronologicalId<FileId>(),
        spaceId,
        contentType: "image/png",
        contentLength: 1024,
        isUploading: false,
        alternative: null,
        ...overrides,
    };
}

describe("getFilePreviewSize", () => {
    test("null file returns small fallback", () => {
        expect(getFilePreviewSize(null)).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("file with null preview returns small fallback", () => {
        const file = createFileModelData({preview: null});
        expect(getFilePreviewSize(file)).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("audio preview returns wide and short size", () => {
        const file = createFileModelData({
            contentType: "audio/mpeg",
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: true,
                duration: 5000,
                metadata: {title: null, artist: null, album: null},
            },
        });
        const result = getFilePreviewSize(file);
        expect(result.width).toBe(largeFallbackWidth);
        // height = width / maxAspectRatio = 600 / (50/21) = 252
        expect(result.height).toBe(largeFallbackWidth * (21 / 50));
    });

    test("code preview returns 63:32 aspect ratio", () => {
        const file = createFileModelData({
            contentType: "text/javascript",
            preview: {
                type: "Code",
                isProcessing: false,
                ok: true,
                content: codeContent,
            },
        });
        const result = getFilePreviewSize(file);
        expect(result.width).toBe(largeFallbackWidth);
        expect(result.height).toBe(largeFallbackWidth / (63 / 32));
    });

    test("image preview with processing size returns large fallback", () => {
        const file = createFileModelData({
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        });
        expect(getFilePreviewSize(file)).toEqual({
            width: largeFallbackWidth,
            height: largeFallbackWidth / (3 / 2),
        });
    });

    test("image preview with error size returns small fallback", () => {
        const file = createFileModelData({
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
                size: "Error",
                placeholder: "Error",
            },
        });
        expect(getFilePreviewSize(file)).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("image preview uses actual dimensions", () => {
        const file = createFileModelData({
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 1920, height: 1080, scale: 1, hasAlpha: false},
                placeholder,
            },
        });
        expect(getFilePreviewSize(file)).toEqual({
            width: 1920,
            height: 1080,
        });
    });

    test("image preview with PDF scale divides dimensions by scale", () => {
        const file = createFileModelData({
            contentType: "application/pdf",
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 1224, height: 1584, scale: 2, hasAlpha: false},
                placeholder,
            },
        });
        expect(getFilePreviewSize(file)).toEqual({
            width: 612,
            height: 792,
        });
    });

    test("image preview with scale of 0 is treated as scale 1", () => {
        const file = createFileModelData({
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 800, height: 600, scale: 0, hasAlpha: false},
                placeholder,
            },
        });
        expect(getFilePreviewSize(file)).toEqual({
            width: 800,
            height: 600,
        });
    });
});

describe("getFilePreviewSizeForLayout", () => {
    test("audio content type returns wide and short size", () => {
        const result = getFilePreviewSizeForLayout({contentType: "audio/mpeg"});
        expect(result.width).toBe(contentLargeFallbackFileWidthPx);
        expect(result.height).toBe(contentLargeFallbackFileWidthPx * (21 / 50));
    });

    test("audio/wav content type returns same as audio/mpeg", () => {
        const mpeg = getFilePreviewSizeForLayout({contentType: "audio/mpeg"});
        const wav = getFilePreviewSizeForLayout({contentType: "audio/wav"});
        expect(wav).toEqual(mpeg);
    });

    test("code content type returns 63:32 aspect ratio", () => {
        const result = getFilePreviewSizeForLayout({contentType: "text/javascript"});
        expect(result.width).toBe(contentLargeFallbackFileWidthPx);
        expect(result.height).toBe(contentLargeFallbackFileWidthPx / (63 / 32));
    });

    test("application/json is treated as code", () => {
        const result = getFilePreviewSizeForLayout({contentType: "application/json"});
        expect(result.width).toBe(contentLargeFallbackFileWidthPx);
        expect(result.height).toBe(contentLargeFallbackFileWidthPx / (63 / 32));
    });

    test("image with dimensions uses actual dimensions", () => {
        expect(
            getFilePreviewSizeForLayout({
                contentType: "image/png",
                size: {width: 1920, height: 1080},
            }),
        ).toEqual({width: 1920, height: 1080});
    });

    test("image with scale divides dimensions by scale", () => {
        expect(
            getFilePreviewSizeForLayout({
                contentType: "application/pdf",
                size: {width: 1224, height: 1584, scale: 2},
            }),
        ).toEqual({width: 612, height: 792});
    });

    test("image with no scale defaults to scale 1", () => {
        expect(
            getFilePreviewSizeForLayout({
                contentType: "image/jpeg",
                size: {width: 3000, height: 2000},
            }),
        ).toEqual({width: 3000, height: 2000});
    });

    test("size with null width returns large fallback", () => {
        expect(
            getFilePreviewSizeForLayout({
                contentType: "image/png",
                size: {width: null, height: 500},
            }),
        ).toEqual({
            width: contentLargeFallbackFileWidthPx,
            height: contentLargeFallbackFileWidthPx / (3 / 2),
        });
    });

    test("null size returns small fallback", () => {
        expect(getFilePreviewSizeForLayout({contentType: "image/png", size: null})).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("no size property returns small fallback", () => {
        expect(getFilePreviewSizeForLayout({contentType: "image/png"})).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("binary content type without size returns small fallback", () => {
        expect(getFilePreviewSizeForLayout({contentType: "application/octet-stream"})).toEqual({
            width: 200,
            height: 200 / (3 / 2),
        });
    });

    test("binary content type with dimensions uses actual dimensions", () => {
        expect(
            getFilePreviewSizeForLayout({
                contentType: "application/octet-stream",
                size: {width: 500, height: 400},
            }),
        ).toEqual({width: 500, height: 400});
    });

    test("audio and code produce same results as getFilePreviewSize", () => {
        const audioForLayout = getFilePreviewSizeForLayout({contentType: "audio/mpeg"});
        const audioBase = getFilePreviewSize(
            createFileModelData({
                contentType: "audio/mpeg",
                preview: {
                    type: "Audio",
                    isProcessing: false,
                    ok: true,
                    duration: 5000,
                    metadata: {title: null, artist: null, album: null},
                },
            }),
        );
        expect(audioForLayout).toEqual(audioBase);

        const codeForLayout = getFilePreviewSizeForLayout({contentType: "text/javascript"});
        const codeBase = getFilePreviewSize(
            createFileModelData({
                contentType: "text/javascript",
                preview: {
                    type: "Code",
                    isProcessing: false,
                    ok: true,
                    content: codeContent,
                },
            }),
        );
        expect(codeForLayout).toEqual(codeBase);
    });
});
