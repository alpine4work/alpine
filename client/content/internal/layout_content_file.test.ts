import {
    layoutContentFileFloat,
    layoutContentFileRow,
} from "~/client/content/internal/layout_content_file.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const screenWidth = 1920;

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
        size: {width: 3992, height: 2992, scale: 1},
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
        size: {width: 8064, height: 6048, scale: 1},
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
        size: {width: 5339, height: 7118, scale: 1},
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
        size: {width: 828, height: 1792, scale: 1},
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
        size: {width: 4096, height: 1716, scale: 1},
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
        size: {width: 1716, height: 4096, scale: 1},
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
        size: {width: 64, height: 64, scale: 1},
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
        size: {width: 100, height: 1000, scale: 1},
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
        size: {width: 1000, height: 100, scale: 1},
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
        size: {width: 1000, height: 10000, scale: 1},
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
        size: {width: 10000, height: 1000, scale: 1},
        placeholder: fileImagePreviewPlaceholder,
    },
});

test("can layout a file row", () => {
    expect(layoutContentFileRow([file1], {screenWidth, isMobile: false})).toEqual([
        {height: 449.69939879759517, width: 600, widthFr: 1},
    ]);

    expect(layoutContentFileRow([file2], {screenWidth, isMobile: false})).toEqual([
        {height: 450, width: 600, widthFr: 1},
    ]);

    expect(layoutContentFileRow([file3], {screenWidth, isMobile: false})).toEqual([
        {height: 511.99999999999994, width: 384.0359651587524, widthFr: 0.6400599419312539},
    ]);

    expect(layoutContentFileRow([file4], {screenWidth, isMobile: false})).toEqual([
        {height: 512, width: 236.57142857142858, widthFr: 0.3942857142857143},
    ]);

    expect(layoutContentFileRow([file5], {screenWidth, isMobile: false})).toEqual([
        {height: 252, width: 600, widthFr: 1},
    ]);

    expect(layoutContentFileRow([file6], {screenWidth, isMobile: false})).toEqual([
        {height: 512, width: 215.04, widthFr: 0.3584},
    ]);

    expect(layoutContentFileRow([file7], {screenWidth, isMobile: false})).toEqual([
        {height: 80, width: 80, widthFr: 0.13333333333333333},
    ]);

    expect(layoutContentFileRow([file8], {screenWidth, isMobile: false})).toEqual([
        {height: 238.0952380952381, width: 100, widthFr: 0.16666666666666666},
    ]);

    expect(layoutContentFileRow([file9], {screenWidth, isMobile: false})).toEqual([
        {height: 100, width: 238.0952380952381, widthFr: 0.39682539682539686},
    ]);

    expect(layoutContentFileRow([file10], {screenWidth, isMobile: false})).toEqual([
        {height: 512, width: 215.04, widthFr: 0.3584},
    ]);

    expect(layoutContentFileRow([file11], {screenWidth, isMobile: false})).toEqual([
        {height: 252, width: 600, widthFr: 1},
    ]);

    expect(layoutContentFileRow([file1, file2], {screenWidth, isMobile: false})).toEqual([
        {height: 221.17607751419982, width: 295.0985633144003, widthFr: 0.5001670564650852},
        {height: 221.17607751419982, width: 294.9014366855997, widthFr: 0.49983294353491475},
    ]);

    expect(layoutContentFileRow([file1, file3, file2], {screenWidth, isMobile: false})).toEqual([
        {height: 169.70833865185892, width: 226.42904007293475, widthFr: 0.39039489667747374},
        {height: 169.70833865185892, width: 127.29317505792004, widthFr: 0.21947099147917248},
        {height: 169.70833865185892, width: 226.2777848691452, widthFr: 0.3901341118433538},
    ]);

    expect(layoutContentFileRow([file1, file3], {screenWidth, isMobile: false})).toEqual([
        {height: 283.0693564653716, width: 377.6780985995198, widthFr: 0.6401323705076607},
        {height: 283.0693564653716, width: 212.32190140048027, widthFr: 0.35986762949233947},
    ]);

    expect(layoutContentFileRow([file3, file1], {screenWidth, isMobile: false})).toEqual([
        {height: 283.06935646537147, width: 212.32190140048027, widthFr: 0.35986762949233947},
        {height: 283.06935646537147, width: 377.6780985995197, widthFr: 0.6401323705076606},
    ]);

    expect(layoutContentFileRow([file1, file5], {screenWidth, isMobile: false})).toEqual([
        {height: 158.80804688303232, width: 211.88560265944685, widthFr: 0.3591281401007574},
        {height: 158.80804688303232, width: 378.11439734055307, widthFr: 0.6408718598992424},
    ]);

    expect(layoutContentFileRow([file1, file6], {screenWidth, isMobile: false})).toEqual([
        {height: 336.33093525179856, width: 448.7410071942446, widthFr: 0.7605779782953298},
        {height: 336.33093525179856, width: 141.25899280575538, widthFr: 0.23942202170467014},
    ]);

    expect(layoutContentFileRow([file4, file4], {screenWidth, isMobile: false})).toEqual([
        {height: 511.9999999999999, width: 236.57142857142856, widthFr: 0.4009685230024213},
        {height: 511.9999999999999, width: 236.57142857142856, widthFr: 0.4009685230024213},
    ]);

    expect(layoutContentFileRow([file4, file4, file4], {screenWidth, isMobile: false})).toEqual([
        {height: 418.4219001610306, width: 193.33333333333334, widthFr: 0.33333333333333337},
        {height: 418.4219001610306, width: 193.33333333333331, widthFr: 0.3333333333333333},
        {height: 418.4219001610306, width: 193.33333333333331, widthFr: 0.3333333333333333},
    ]);

    expect(layoutContentFileRow([file7, file1], {screenWidth, isMobile: false})).toEqual([
        {height: 80, width: 80, widthFr: 0.13559322033898305},
        {height: 80, width: 106.7379679144385, widthFr: 0.18091181002447204},
    ]);

    expect(layoutContentFileRow([file7, file3], {screenWidth, isMobile: false})).toEqual([
        {height: 80, width: 80, widthFr: 0.13559322033898305},
        {height: 80, width: 80, widthFr: 0.13559322033898305},
    ]);
});

test("can layout a file float", () => {
    expect(layoutContentFileFloat("left", file1, {screenWidth, isMobile: false})).toEqual({
        width: 204.79679144385028,
        height: 154,
    });

    expect(layoutContentFileFloat("left", file2, {screenWidth, isMobile: false})).toEqual({
        width: 204.66666666666666,
        height: 154,
    });

    expect(layoutContentFileFloat("left", file3, {screenWidth, isMobile: false})).toEqual({
        width: 202.01798257937628,
        height: 264,
    });

    expect(layoutContentFileFloat("left", file4, {screenWidth, isMobile: false})).toEqual({
        width: 209.60714285714286,
        height: 440,
    });

    expect(layoutContentFileFloat("left", file5, {screenWidth, isMobile: false})).toEqual({
        width: 210,
        height: 96,
    });

    expect(layoutContentFileFloat("left", file6, {screenWidth, isMobile: false})).toEqual({
        width: 209.92,
        height: 484,
    });

    expect(layoutContentFileFloat("left", file7, {screenWidth, isMobile: false})).toEqual({
        width: 90,
        height: 96,
    });

    expect(layoutContentFileFloat("left", file8, {screenWidth, isMobile: false})).toEqual({
        width: 108.27999999999999,
        height: 242,
    });

    expect(layoutContentFileFloat("left", file9, {screenWidth, isMobile: false})).toEqual({
        width: 210,
        height: 96,
    });

    expect(layoutContentFileFloat("left", file10, {screenWidth, isMobile: false})).toEqual({
        width: 209.92,
        height: 484,
    });

    expect(layoutContentFileFloat("left", file11, {screenWidth, isMobile: false})).toEqual({
        width: 210,
        height: 96,
    });
});
