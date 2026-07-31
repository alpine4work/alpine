import {
    computeContentFileFloatLayout,
    computeContentFileRowLikeLayout,
} from "~/client/web/content/state/content_file_layout_computations.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {contentLargeFallbackFileWidthPx} from "~/shared/design/core/content_shared_styles.js";
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    analysis: null,
    transcript: null,
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
    ).toEqual([{height: 449.6993987975952, width: 600, widthFr: 1}]);
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
    ).toEqual([{height: 251.3671875, width: 600, widthFr: 1}]);
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
        {
            height: 221.9258269295022,
            width: 296.0988974273305,
            widthFr: 0.5001670564650853,
        },
        {
            height: 221.9258269295022,
            width: 295.9011025726696,
            widthFr: 0.4998329435349148,
        },
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
        {
            height: 170.87874098738897,
            width: 227.99061965964466,
            widthFr: 0.39039489667747374,
        },
        {
            height: 170.87874098738897,
            width: 128.1710590238367,
            widthFr: 0.21947099147917243,
        },
        {
            height: 170.87874098738897,
            width: 227.83832131651863,
            widthFr: 0.39013411184335384,
        },
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
        {
            height: 284.0289136059321,
            width: 378.9583633405351,
            widthFr: 0.6401323705076606,
        },
        {
            height: 284.0289136059321,
            width: 213.04163665946496,
            widthFr: 0.35986762949233947,
        },
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
        {
            height: 284.028913605932,
            width: 213.04163665946493,
            widthFr: 0.3598676294923394,
        },
        {
            height: 284.028913605932,
            width: 378.958363340535,
            widthFr: 0.6401323705076605,
        },
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
        {
            height: 159.3463792453477,
            width: 212.60385893964838,
            widthFr: 0.3591281401007574,
        },
        {
            height: 159.3463792453477,
            width: 379.3961410603516,
            widthFr: 0.6408718598992426,
        },
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
        {
            height: 337.4710401170589,
            width: 450.26216315083525,
            widthFr: 0.7605779782953298,
        },
        {
            height: 337.4710401170589,
            width: 141.73783684916475,
            widthFr: 0.2394220217046702,
        },
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
        {
            height: 421.30756843800316,
            width: 194.66666666666666,
            widthFr: 0.3333333333333333,
        },
        {
            height: 421.30756843800316,
            width: 194.66666666666666,
            widthFr: 0.3333333333333333,
        },
        {
            height: 421.30756843800316,
            width: 194.66666666666666,
            widthFr: 0.3333333333333333,
        },
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
        {height: 200, width: 476.1904761904762, widthFr: 0.8043758043758044},
        {height: 200, width: 115.80952380952381, widthFr: 0.1956241956241956},
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
        {height: 225.41176470588235, width: 296, widthFr: 0.5},
        {height: 225.41176470588235, width: 296, widthFr: 0.5},
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
        {height: 76, width: 76, widthFr: 0.5352112676056338},
        {height: 76, width: 76, widthFr: 0.5352112676056338},
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
        {
            height: 223.61756563286082,
            width: 293.6439431796857,
            widthFr: 0.49602017429000966,
        },
        {
            height: 223.61756563286082,
            width: 298.3560568203143,
            widthFr: 0.5039798257099903,
        },
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
        {
            height: 225.41176470588235,
            width: 422.92534254499776,
            widthFr: 0.7144009164611449,
        },
        {
            height: 225.41176470588235,
            width: 169.0746574550022,
            widthFr: 0.2855990835388551,
        },
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
        {
            height: 258.8235294117647,
            width: 194.66666666666669,
            widthFr: 0.33333333333333337,
        },
        {
            height: 258.8235294117647,
            width: 194.66666666666669,
            widthFr: 0.33333333333333337,
        },
        {
            height: 258.8235294117647,
            width: 194.66666666666669,
            widthFr: 0.33333333333333337,
        },
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
        {
            height: 205.74485989525115,
            width: 154.74507341212527,
            widthFr: 0.2649744407741871,
        },
        {
            height: 205.74485989525115,
            width: 154.74507341212527,
            widthFr: 0.2649744407741871,
        },
        {
            height: 205.74485989525115,
            width: 274.50985317574947,
            widthFr: 0.4700511184516258,
        },
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
        {
            height: 258.8235294117647,
            width: 194.93208601226388,
            widthFr: 0.33378781851415046,
        },
        {
            height: 258.8235294117647,
            width: 194.93208601226388,
            widthFr: 0.33378781851415046,
        },
        {
            height: 258.8235294117647,
            width: 194.13582797547227,
            widthFr: 0.3324243629716991,
        },
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
        {
            height: 205.89363075529582,
            width: 154.85696713171038,
            widthFr: 0.26516603960909313,
        },
        {
            height: 205.89363075529582,
            width: 274.7083469168252,
            widthFr: 0.47039100499456366,
        },
        {
            height: 205.89363075529582,
            width: 154.4346859514645,
            widthFr: 0.2644429553963433,
        },
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
    ).toEqual([{height: 274.5882352941177, width: 276, widthFr: 1}]);
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
    ).toEqual([{height: 242.23529411764707, width: 226, widthFr: 1}]);
});

test("layouts file entity in table with a column width that\u2019s more less than a third of the block width", () => {
    expect(
        computeContentFileRowLikeLayout([`Document:${generateId<DocumentId>()}`], {
            maxFileCount: 1,
            blockWidth: 176,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 227.76470588235296, width: 176, widthFr: 1}]);
});

test("floats standard image left", () => {
    expect(
        computeContentFileFloatLayout("left", standardFile.initialData, {
            blockWidth: 600,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 177.0516042780749,
        widthFr: 1,
        height: 132.70000000000002,
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
        width: 176.93333333333334,
        widthFr: 1,
        height: 132.70000000000002,
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
        width: 194.04317223939307,
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
        width: 148.64263392857143,
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
        width: 194.66666666666666,
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
        width: 194.66666666666666,
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
        width: 194.66666666666666,
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
        width: 194.66666666666666,
        widthFr: 1,
        height: 258.7,
    });
});

test("contentLargeFallbackFileWidthPx matches mobile block max width at large spacing scale", () => {
    expect(contentLargeFallbackFileWidthPx).toEqual(
        contentStyles.blockMaxWidthRem.mobile * remPxBySpacingScale.large,
    );
});
