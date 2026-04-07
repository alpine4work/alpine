import {
    computeContentFileFloatLayout,
    computeContentFileRowLikeLayout,
} from "~/client/web/content/state/content_file_layout_computations.js";
import {screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();

const fileImagePreviewPlaceholder = new FileImagePreviewPlaceholder([
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

const standardFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 3992, height: 2992, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const largeFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 8064, height: 6048, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const tallFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 5339, height: 7118, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

// iPhone screenshot size
const phoneScreenshotFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 828, height: 1792, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

// Cinema "scope" 4k resolution
const cinemaScopeFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 4096, height: 1716, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

// Cinema "scope" 4k resolution (vertical)
const cinemaScopeVerticalFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 1716, height: 4096, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const iconFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 64, height: 64, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const moderateVerticalFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 200, height: 2000, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const moderateHorizontalFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 2000, height: 200, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const extremeVerticalFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 1000, height: 10000, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const extremeHorizontalFile = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "image/png",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        isProcessing: false,
        type: "Image",
        ok: true,
        size: {width: 10000, height: 1000, scale: 1, hasAlpha: false},
        placeholder: fileImagePreviewPlaceholder,
    },
});

const audioFile1 = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "audio/mp4",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        type: "Audio",
        isProcessing: false,
        ok: true,
        duration: 1000,
        metadata: {title: null, artist: null, album: null},
    },
});

const audioFile2 = new FileModel({
    spaceId,
    id: generateChronologicalId<FileId>(),
    contentType: "audio/mp4",
    contentLength: 100,
    isUploading: false,
    alternative: null,
    preview: {
        type: "Audio",
        isProcessing: false,
        ok: true,
        duration: 1000,
        metadata: {title: null, artist: null, album: null},
    },
});

test("layouts single standard image", () => {
    expect(
        computeContentFileRowLikeLayout([standardFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 449.699, width: 600, widthFr: 1}]);
});

test("layouts single large image", () => {
    expect(
        computeContentFileRowLikeLayout([largeFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 450, width: 600, widthFr: 1}]);
});

test("layouts single tall image", () => {
    expect(
        computeContentFileRowLikeLayout([tallFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 600, widthFr: 1}]);
});

test("layouts iPhone screenshot", () => {
    expect(
        computeContentFileRowLikeLayout([phoneScreenshotFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 600, widthFr: 1}]);
});

test("layouts cinema scope image", () => {
    expect(
        computeContentFileRowLikeLayout([cinemaScopeFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 251.367, width: 600, widthFr: 1}]);
});

test("layouts vertical cinema scope image", () => {
    expect(
        computeContentFileRowLikeLayout([cinemaScopeVerticalFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 600, widthFr: 1}]);
});

test("layouts small icon image", () => {
    expect(
        computeContentFileRowLikeLayout([iconFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 76, width: 600, widthFr: 1}]);
});

test("layouts moderate vertical image", () => {
    expect(
        computeContentFileRowLikeLayout([moderateVerticalFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 600, widthFr: 1}]);
});

test("layouts moderate horizontal image", () => {
    expect(
        computeContentFileRowLikeLayout([moderateHorizontalFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 76, width: 600, widthFr: 1}]);
});

test("layouts extreme vertical image", () => {
    expect(
        computeContentFileRowLikeLayout([extremeVerticalFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 600, widthFr: 1}]);
});

test("layouts extreme horizontal image", () => {
    expect(
        computeContentFileRowLikeLayout([extremeHorizontalFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 76, width: 600, widthFr: 1}]);
});

test("layouts two similar images in a row", () => {
    expect(
        computeContentFileRowLikeLayout([standardFile.initialData, largeFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 221.926, width: 296.099, widthFr: 0.500167},
        {height: 221.926, width: 295.901, widthFr: 0.499833},
    ]);
});

test("layouts three images in a row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [standardFile.initialData, tallFile.initialData, largeFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 170.879, width: 227.991, widthFr: 0.390395},
        {height: 170.879, width: 128.171, widthFr: 0.219471},
        {height: 170.879, width: 227.838, widthFr: 0.390134},
    ]);
});

test("layouts standard and tall image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([standardFile.initialData, tallFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 284.029, width: 378.958, widthFr: 0.640132},
        {height: 284.029, width: 213.042, widthFr: 0.359868},
    ]);
});

test("layouts tall and standard image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([tallFile.initialData, standardFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 284.029, width: 213.042, widthFr: 0.359868},
        {height: 284.029, width: 378.958, widthFr: 0.640132},
    ]);
});

test("layouts standard and wide image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([standardFile.initialData, cinemaScopeFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 159.346, width: 212.604, widthFr: 0.359128},
        {height: 159.346, width: 379.396, widthFr: 0.640872},
    ]);
});

test("layouts standard and vertical cinema image in a row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [standardFile.initialData, cinemaScopeVerticalFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 337.471, width: 450.262, widthFr: 0.760578},
        {height: 337.471, width: 141.738, widthFr: 0.239422},
    ]);
});

test("layouts two iPhone screenshots in a row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [phoneScreenshotFile.initialData, phoneScreenshotFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 512, width: 296, widthFr: 0.5},
        {height: 512, width: 296, widthFr: 0.5},
    ]);
});

test("layouts three iPhone screenshots in a row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [
                phoneScreenshotFile.initialData,
                phoneScreenshotFile.initialData,
                phoneScreenshotFile.initialData,
            ],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 421.308, width: 194.667, widthFr: 0.333333},
        {height: 421.308, width: 194.667, widthFr: 0.333333},
        {height: 421.308, width: 194.667, widthFr: 0.333333},
    ]);
});

test("layouts moderate horizontal image and iPhone screenshot in a row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [moderateHorizontalFile.initialData, phoneScreenshotFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 200, width: 476.19, widthFr: 0.804376},
        {height: 200, width: 115.81, widthFr: 0.195624},
    ]);
});

test("layouts small icon and standard image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([iconFile.initialData, standardFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 76, width: 296, widthFr: 0.5},
        {height: 76, width: 296, widthFr: 0.5},
    ]);
});

test("layouts small icon and tall image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([iconFile.initialData, tallFile.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 76, width: 296, widthFr: 0.5},
        {height: 76, width: 296, widthFr: 0.5},
    ]);
});

test("layouts two audio files in a row", () => {
    expect(
        computeContentFileRowLikeLayout([audioFile1.initialData, audioFile2.initialData], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 124.32, width: 296, widthFr: 0.5},
        {height: 124.32, width: 296, widthFr: 0.5},
    ]);
});

test("layouts two audio files in a row on mobile", () => {
    expect(
        computeContentFileRowLikeLayout([audioFile1.initialData, audioFile2.initialData], {
            maxFileCount: 3,
            blockWidth: 390 - screenPaddingXRem.mobile * remPxBySpacingScale.large * 2,
            platform: "mobile",
            spacingScale: "large",
        }),
    ).toEqual([
        {height: 95, width: 175, widthFr: 0.5},
        {height: 95, width: 175, widthFr: 0.5},
    ]);
});

test("layouts file entity", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 3,
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 192, width: 600, widthFr: 1}]);
});

test("layouts two file entities", () => {
    expect(
        computeContentFileRowLikeLayout(
            [`Document:${generateId<DocumentId>()}`, `Document:${generateId<DocumentId>()}`],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 225.412, width: 296, widthFr: 0.5},
        {height: 225.412, width: 296, widthFr: 0.5},
    ]);
});

test("throws unsatisfiable constraint for two file entities in a narrow row", () => {
    expect(
        computeContentFileRowLikeLayout(
            [`Document:${generateId<DocumentId>()}`, `Document:${generateId<DocumentId>()}`],
            {
                maxFileCount: 3,
                blockWidth: 150,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 76, width: 76, widthFr: 0.535211},
        {height: 76, width: 76, widthFr: 0.535211},
    ]);
});

test("layouts file entity and standard image", () => {
    expect(
        computeContentFileRowLikeLayout(
            [`Document:${generateId<DocumentId>()}`, standardFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 223.618, width: 293.644, widthFr: 0.49602},
        {height: 223.618, width: 298.356, widthFr: 0.50398},
    ]);
});

test("layouts file entity and tall image", () => {
    expect(
        computeContentFileRowLikeLayout(
            [`Document:${generateId<DocumentId>()}`, tallFile.initialData],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 225.412, width: 422.925, widthFr: 0.714401},
        {height: 225.412, width: 169.075, widthFr: 0.285599},
    ]);
});

test("layouts three file entities", () => {
    expect(
        computeContentFileRowLikeLayout(
            [
                `Document:${generateId<DocumentId>()}`,
                `Document:${generateId<DocumentId>()}`,
                `Document:${generateId<DocumentId>()}`,
            ],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 258.824, width: 194.667, widthFr: 0.333333},
        {height: 258.824, width: 194.667, widthFr: 0.333333},
        {height: 258.824, width: 194.667, widthFr: 0.333333},
    ]);
});

test("layouts two file entities and standard image", () => {
    expect(
        computeContentFileRowLikeLayout(
            [
                `Document:${generateId<DocumentId>()}`,
                `Document:${generateId<DocumentId>()}`,
                standardFile.initialData,
            ],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 205.745, width: 154.745, widthFr: 0.264974},
        {height: 205.745, width: 154.745, widthFr: 0.264974},
        {height: 205.745, width: 274.51, widthFr: 0.470051},
    ]);
});

test("layouts two file entities and tall image", () => {
    expect(
        computeContentFileRowLikeLayout(
            [
                `Document:${generateId<DocumentId>()}`,
                `Document:${generateId<DocumentId>()}`,
                tallFile.initialData,
            ],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 258.824, width: 194.932, widthFr: 0.333788},
        {height: 258.824, width: 194.932, widthFr: 0.333788},
        {height: 258.824, width: 194.136, widthFr: 0.332424},
    ]);
});

test("layouts file entity, standard image, and tall image", () => {
    expect(
        computeContentFileRowLikeLayout(
            [
                `Document:${generateId<DocumentId>()}`,
                standardFile.initialData,
                tallFile.initialData,
            ],
            {
                maxFileCount: 3,
                blockWidth: 600,
                platform: "desktop",
                spacingScale: "small",
            },
        ),
    ).toEqual([
        {height: 205.894, width: 154.857, widthFr: 0.265166},
        {height: 205.894, width: 274.708, widthFr: 0.470391},
        {height: 205.894, width: 154.435, widthFr: 0.264443},
    ]);
});

test("layouts file entity in table with a column width that\u2019s half the block width", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 276,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 274.588, width: 276, widthFr: 1}]);
});

test("layouts file entity in table with a column width that\u2019s more than half the block width", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 326,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 192, width: 326, widthFr: 1}]);

    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 476,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 192, width: 476, widthFr: 1}]);
});

test("layouts file entity in table with a column width that\u2019s more less than half the block width", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 226,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 242.235, width: 226, widthFr: 1}]);
});

test("layouts file entity in table with a column width that\u2019s more less than a third of the block width", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 176,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 227.765, width: 176, widthFr: 1}]);
});

test("floats standard image left", () => {
    expect(
        computeContentFileFloatLayout("left", standardFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 177.052,
        widthFr: 1,
        height: 132.7,
    });
});

test("floats large image left", () => {
    expect(
        computeContentFileFloatLayout("left", largeFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 176.933,
        widthFr: 1,
        height: 132.7,
    });
});

test("floats tall image left", () => {
    expect(
        computeContentFileFloatLayout("left", tallFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 194.043,
        widthFr: 1,
        height: 258.7,
    });
});

test("floats iPhone screenshot left", () => {
    expect(
        computeContentFileFloatLayout("left", phoneScreenshotFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 148.643,
        widthFr: 1,
        height: 321.7,
    });
});

test("floats cinema scope image left", () => {
    expect(
        computeContentFileFloatLayout("left", cinemaScopeFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 194.667,
        widthFr: 1,
        height: 84,
    });
});

test("floats vertical cinema scope image left", () => {
    expect(
        computeContentFileFloatLayout("left", cinemaScopeVerticalFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 135.114,
        widthFr: 1,
        height: 321.7,
    });
});

test("floats small icon image left", () => {
    expect(
        computeContentFileFloatLayout("left", iconFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 76,
        widthFr: 1,
        height: 84,
    });
});

test("floats vertical banner image left", () => {
    expect(
        computeContentFileFloatLayout("left", moderateVerticalFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 135.114,
        widthFr: 1,
        height: 321.7,
    });
});

test("floats horizontal banner image left", () => {
    expect(
        computeContentFileFloatLayout("left", moderateHorizontalFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 194.667,
        widthFr: 1,
        height: 84,
    });
});

test("floats extreme vertical image left", () => {
    expect(
        computeContentFileFloatLayout("left", extremeVerticalFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 135.114,
        widthFr: 1,
        height: 321.7,
    });
});

test("floats extreme horizontal image left", () => {
    expect(
        computeContentFileFloatLayout("left", extremeHorizontalFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 194.667,
        widthFr: 1,
        height: 84,
    });
});

test("floats file entity", () => {
    expect(
        computeContentFileFloatLayout("left", `Document:${generateId<DocumentId>()}`, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 194.667,
        widthFr: 1,
        height: 258.7,
    });
});
