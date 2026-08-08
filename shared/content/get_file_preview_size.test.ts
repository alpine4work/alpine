import {getFilePreviewSize} from "~/shared/content/get_file_preview_size.js";
import {contentLargeFallbackFileWidthPx} from "~/shared/design/core/content_shared_styles.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

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
        analysis: overrides.analysis ?? null,
        transcript: overrides.transcript ?? null,
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
        expect(getFilePreviewSize(file.preview)).toEqual({
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
        const result = getFilePreviewSize(file.preview);
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
        const result = getFilePreviewSize(file.preview);
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
        expect(getFilePreviewSize(file.preview)).toEqual({
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
        expect(getFilePreviewSize(file.preview)).toEqual({
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
        expect(getFilePreviewSize(file.preview)).toEqual({
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
        expect(getFilePreviewSize(file.preview)).toEqual({
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
        expect(getFilePreviewSize(file.preview)).toEqual({
            width: 800,
            height: 600,
        });
    });
});
