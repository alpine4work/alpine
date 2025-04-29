import {
    computeContentFileFloatLayout,
    computeContentFileRowLikeLayout,
} from "~/client/content/internal/content_file_layout_computations.js";
import {screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

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

const file1 = new FileModel({
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

const file2 = new FileModel({
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

const file3 = new FileModel({
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
const file4 = new FileModel({
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
const file5 = new FileModel({
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
const file6 = new FileModel({
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

const file7 = new FileModel({
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

const file8 = new FileModel({
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

const file9 = new FileModel({
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

const file10 = new FileModel({
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

const file11 = new FileModel({
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
        computeContentFileRowLikeLayout([file1.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 449.699, width: 600, widthFr: 1}]);
});

test("layouts single large image", () => {
    expect(
        computeContentFileRowLikeLayout([file2.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 450, width: 600, widthFr: 1}]);
});

test("layouts single tall image", () => {
    expect(
        computeContentFileRowLikeLayout([file3.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 384.036, widthFr: 0.64006}]);
});

test("layouts iPhone screenshot", () => {
    expect(
        computeContentFileRowLikeLayout([file4.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 236.571, widthFr: 0.394286}]);
});

test("layouts cinema scope image", () => {
    expect(
        computeContentFileRowLikeLayout([file5.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 251.367, width: 600, widthFr: 1}]);
});

test("layouts vertical cinema scope image", () => {
    expect(
        computeContentFileRowLikeLayout([file6.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 215.04, widthFr: 0.3584}]);
});

test("layouts small icon image", () => {
    expect(
        computeContentFileRowLikeLayout([file7.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 76, width: 76, widthFr: 0.126667}]);
});

test("layouts vertical banner image", () => {
    expect(
        computeContentFileRowLikeLayout([file8.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 238.095, width: 100, widthFr: 0.166667}]);
});

test("layouts horizontal banner image", () => {
    expect(
        computeContentFileRowLikeLayout([file9.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 100, width: 318, widthFr: 0.53}]);
});

test("layouts extreme vertical image", () => {
    expect(
        computeContentFileRowLikeLayout([file10.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 215.04, widthFr: 0.3584}]);
});

test("layouts extreme horizontal image", () => {
    expect(
        computeContentFileRowLikeLayout([file11.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([{height: 188.679, width: 600, widthFr: 1}]);
});

test("layouts two similar images in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file1.initialData, file2.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 221.926, width: 296.099, widthFr: 0.500167},
        {height: 221.926, width: 295.901, widthFr: 0.499833},
    ]);
});

test("layouts three images in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file1.initialData, file3.initialData, file2.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 170.879, width: 227.991, widthFr: 0.390395},
        {height: 170.879, width: 128.171, widthFr: 0.219471},
        {height: 170.879, width: 227.838, widthFr: 0.390134},
    ]);
});

test("layouts standard and tall image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file1.initialData, file3.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 284.029, width: 378.958, widthFr: 0.640132},
        {height: 284.029, width: 213.042, widthFr: 0.359868},
    ]);
});

test("layouts tall and standard image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file3.initialData, file1.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 284.029, width: 213.042, widthFr: 0.359868},
        {height: 284.029, width: 378.958, widthFr: 0.640132},
    ]);
});

test("layouts standard and wide image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file1.initialData, file5.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 159.09, width: 212.261, widthFr: 0.35855},
        {height: 159.09, width: 379.739, widthFr: 0.64145},
    ]);
});

test("layouts standard and vertical cinema image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file1.initialData, file6.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 337.471, width: 450.262, widthFr: 0.760578},
        {height: 337.471, width: 141.738, widthFr: 0.239422},
    ]);
});

test("layouts two iPhone screenshots in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file4.initialData, file4.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 512, width: 236.571, widthFr: 0.399614},
        {height: 512, width: 236.571, widthFr: 0.399614},
    ]);
});

test("layouts three iPhone screenshots in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file4.initialData, file4.initialData, file4.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 421.308, width: 194.667, widthFr: 0.333333},
        {height: 421.308, width: 194.667, widthFr: 0.333333},
        {height: 421.308, width: 194.667, widthFr: 0.333333},
    ]);
});

test("layouts small icon and standard image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file7.initialData, file1.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 76, width: 76, widthFr: 0.128378},
        {height: 76, width: 101.401, widthFr: 0.171286},
    ]);
});

test("layouts small icon and tall image in a row", () => {
    expect(
        computeContentFileRowLikeLayout([file7.initialData, file3.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 76, width: 76, widthFr: 0.128378},
        {height: 76, width: 76, widthFr: 0.128378},
    ]);
});

test("layouts two audio files in a row", () => {
    expect(
        computeContentFileRowLikeLayout([audioFile1.initialData, audioFile2.initialData], {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 93.082, width: 296, widthFr: 0.5},
        {height: 93.082, width: 296, widthFr: 0.5},
    ]);
});

test("layouts two audio files in a row on mobile", () => {
    expect(
        computeContentFileRowLikeLayout([audioFile1.initialData, audioFile2.initialData], {
            blockWidth: 390 - screenPaddingXRem.mobile * remPxBySpacingScale.large * 2,
            spacingScale: "large",
        }),
    ).toEqual([
        {height: 95, width: 175, widthFr: 0.5},
        {height: 95, width: 175, widthFr: 0.5},
    ]);
});

test("floats standard image left", () => {
    expect(
        computeContentFileFloatLayout("left", file1.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 197.052,
        widthFr: 1,
        height: 140.7,
    });
});

test("floats large image left", () => {
    expect(
        computeContentFileFloatLayout("left", file2.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 196.933,
        widthFr: 1,
        height: 140.7,
    });
});

test("floats tall image left", () => {
    expect(
        computeContentFileFloatLayout("left", file3.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 214.043,
        widthFr: 1,
        height: 266.7,
    });
});

test("floats iPhone screenshot left", () => {
    expect(
        computeContentFileFloatLayout("left", file4.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 168.643,
        widthFr: 1,
        height: 329.7,
    });
});

test("floats cinema scope image left", () => {
    expect(
        computeContentFileFloatLayout("left", file5.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 92,
    });
});

test("floats vertical cinema scope image left", () => {
    expect(
        computeContentFileFloatLayout("left", file6.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 155.114,
        widthFr: 1,
        height: 329.7,
    });
});

test("floats small icon image left", () => {
    expect(
        computeContentFileFloatLayout("left", file7.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 96,
        widthFr: 1,
        height: 92,
    });
});

test("floats vertical banner image left", () => {
    expect(
        computeContentFileFloatLayout("left", file8.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 119.834,
        widthFr: 1,
        height: 245.7,
    });
});

test("floats horizontal banner image left", () => {
    expect(
        computeContentFileFloatLayout("left", file9.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 92,
    });
});

test("floats extreme vertical image left", () => {
    expect(
        computeContentFileFloatLayout("left", file10.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 155.114,
        widthFr: 1,
        height: 329.7,
    });
});

test("floats extreme horizontal image left", () => {
    expect(
        computeContentFileFloatLayout("left", file11.initialData, {
            blockWidth: 600,
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 92,
    });
});
