import {
    computeContentFileFloatLayout,
    computeContentFileRowLayout,
} from "~/client/content/internal/content_file_layout_computations.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const screenWidth = 1920;
const mobileScreenWidth = 390;

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

test("can layout a file row", () => {
    expect(
        computeContentFileRowLayout([file1], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 449.699, width: 600, widthFr: 1}]);

    expect(
        computeContentFileRowLayout([file2], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 450, width: 600, widthFr: 1}]);

    expect(
        computeContentFileRowLayout([file3], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 384.036, widthFr: 0.64006}]);

    expect(
        computeContentFileRowLayout([file4], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 236.571, widthFr: 0.394286}]);

    expect(
        computeContentFileRowLayout([file5], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 252, width: 600, widthFr: 1}]);

    expect(
        computeContentFileRowLayout([file6], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 215.04, widthFr: 0.3584}]);

    expect(
        computeContentFileRowLayout([file7], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 80, width: 80, widthFr: 0.133333}]);

    expect(
        computeContentFileRowLayout([file8], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 238.095, width: 100, widthFr: 0.166667}]);

    expect(
        computeContentFileRowLayout([file9], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 100, width: 238.095, widthFr: 0.396825}]);

    expect(
        computeContentFileRowLayout([file10], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 512, width: 215.04, widthFr: 0.3584}]);

    expect(
        computeContentFileRowLayout([file11], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([{height: 252, width: 600, widthFr: 1}]);

    expect(
        computeContentFileRowLayout([file1, file2], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 221.176, width: 295.099, widthFr: 0.500167},
        {height: 221.176, width: 294.901, widthFr: 0.499833},
    ]);

    expect(
        computeContentFileRowLayout([file1, file3, file2], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 169.708, width: 226.429, widthFr: 0.390395},
        {height: 169.708, width: 127.293, widthFr: 0.219471},
        {height: 169.708, width: 226.278, widthFr: 0.390134},
    ]);

    expect(
        computeContentFileRowLayout([file1, file3], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 283.069, width: 377.678, widthFr: 0.640132},
        {height: 283.069, width: 212.322, widthFr: 0.359868},
    ]);

    expect(
        computeContentFileRowLayout([file3, file1], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 283.069, width: 212.322, widthFr: 0.359868},
        {height: 283.069, width: 377.678, widthFr: 0.640132},
    ]);

    expect(
        computeContentFileRowLayout([file1, file5], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 158.808, width: 211.886, widthFr: 0.359128},
        {height: 158.808, width: 378.114, widthFr: 0.640872},
    ]);

    expect(
        computeContentFileRowLayout([file1, file6], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 336.331, width: 448.741, widthFr: 0.760578},
        {height: 336.331, width: 141.259, widthFr: 0.239422},
    ]);

    expect(
        computeContentFileRowLayout([file4, file4], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 512, width: 236.571, widthFr: 0.400969},
        {height: 512, width: 236.571, widthFr: 0.400969},
    ]);

    expect(
        computeContentFileRowLayout([file4, file4, file4], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 418.422, width: 193.333, widthFr: 0.333333},
        {height: 418.422, width: 193.333, widthFr: 0.333333},
        {height: 418.422, width: 193.333, widthFr: 0.333333},
    ]);

    expect(
        computeContentFileRowLayout([file7, file1], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 80, width: 80, widthFr: 0.135593},
        {height: 80, width: 106.738, widthFr: 0.180912},
    ]);

    expect(
        computeContentFileRowLayout([file7, file3], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 80, width: 80, widthFr: 0.135593},
        {height: 80, width: 80, widthFr: 0.135593},
    ]);

    expect(
        computeContentFileRowLayout([audioFile1, audioFile2], {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual([
        {height: 123.9, width: 295, widthFr: 0.5},
        {height: 123.9, width: 295, widthFr: 0.5},
    ]);

    expect(
        computeContentFileRowLayout([audioFile1, audioFile2], {
            screenWidth: mobileScreenWidth,
            platform: "mobile",
            spacingScale: "large",
        }),
    ).toEqual([
        {height: 100, width: 173.75, widthFr: 0.5},
        {height: 100, width: 173.75, widthFr: 0.5},
    ]);
});

test("can layout a file float", () => {
    expect(
        computeContentFileFloatLayout("left", file1, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 205.991,
        widthFr: 1,
        height: 147.4,
    });

    expect(
        computeContentFileFloatLayout("left", file2, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 205.867,
        widthFr: 1,
        height: 147.4,
    });

    expect(
        computeContentFileFloatLayout("left", file3, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 207.068,
        widthFr: 1,
        height: 257.4,
    });

    expect(
        computeContentFileFloatLayout("left", file4, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 216.558,
        widthFr: 1,
        height: 433.4,
    });

    expect(
        computeContentFileFloatLayout("left", file5, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 96,
    });

    expect(
        computeContentFileFloatLayout("left", file6, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 217.148,
        widthFr: 1,
        height: 477.4,
    });

    expect(
        computeContentFileFloatLayout("left", file7, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 100,
        widthFr: 1,
        height: 96,
    });

    expect(
        computeContentFileFloatLayout("left", file8, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 115.508,
        widthFr: 1,
        height: 235.4,
    });

    expect(
        computeContentFileFloatLayout("left", file9, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 96,
    });

    expect(
        computeContentFileFloatLayout("left", file10, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 217.148,
        widthFr: 1,
        height: 477.4,
    });

    expect(
        computeContentFileFloatLayout("left", file11, {
            screenWidth,
            platform: "desktop",
            spacingScale: "small",
        }),
    ).toEqual({
        width: 220,
        widthFr: 1,
        height: 96,
    });
});
