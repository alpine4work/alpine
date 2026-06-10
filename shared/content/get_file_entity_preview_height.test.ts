import {getFileEntityPreviewHeight} from "~/shared/content/get_file_entity_preview_height.js";

const blockWidth = 600;
const maxFileCount = 3;
const defaultPreviewHeight = 192;
const letterPaperAspectRatio = 17 / 22;

describe("getFileEntityPreviewHeight", () => {
    test("1 file returns defaultPreviewHeight", () => {
        expect(
            getFileEntityPreviewHeight({
                fileCount: 1,
                maxFileCount,
                blockWidth,
                defaultPreviewHeight,
            }),
        ).toBe(defaultPreviewHeight);
    });

    test("3 files returns letter paper aspect ratio height", () => {
        const expectedHeight = blockWidth / maxFileCount / letterPaperAspectRatio;
        expect(
            getFileEntityPreviewHeight({
                fileCount: 3,
                maxFileCount,
                blockWidth,
                defaultPreviewHeight,
            }),
        ).toBe(expectedHeight);
    });

    test("2 files returns midpoint between 1-file and 3-file heights", () => {
        const oneFileHeight = defaultPreviewHeight;
        const threeFileHeight = blockWidth / maxFileCount / letterPaperAspectRatio;
        const expectedHeight = oneFileHeight + (threeFileHeight - oneFileHeight) / 2;
        expect(
            getFileEntityPreviewHeight({
                fileCount: 2,
                maxFileCount,
                blockWidth,
                defaultPreviewHeight,
            }),
        ).toBe(expectedHeight);
    });

    test("custom aspectRatio overrides the default", () => {
        const customAspectRatio = 1;
        const expectedHeight = blockWidth / maxFileCount / customAspectRatio;
        expect(
            getFileEntityPreviewHeight({
                fileCount: 3,
                maxFileCount,
                blockWidth,
                defaultPreviewHeight,
                aspectRatio: customAspectRatio,
            }),
        ).toBe(expectedHeight);
    });

    test("fileCount 0 returns defaultPreviewHeight", () => {
        expect(
            getFileEntityPreviewHeight({
                fileCount: 0,
                maxFileCount,
                blockWidth,
                defaultPreviewHeight,
            }),
        ).toBe(defaultPreviewHeight);
    });
});
