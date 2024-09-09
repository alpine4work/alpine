import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileUploader,
    getFile,
    startUploadingAndProcessingFile,
} from "~/server/files/data/files_table.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {InternalError, PermissionDeniedError, UnimplementedError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {getChronologicalIdTime} from "~/shared/id/chronological_id.js";

const context = createTestContext();

const filePreviewPlaceholder = new FilePreviewPlaceholder([
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

test("can start uploading and processing files", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const startTime = Date.now();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );
    }

    {
        const startTime = Date.now();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );
    }

    {
        const startTime = Date.now();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );
    }
});

test("can only start uploading and processing a file if you have access to the space", async () => {
    const otherSpace = await TestSpace.create(context);
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        startUploadingAndProcessingFile(session.action(), {
            spaceId: otherSpace.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can't start uploading and processing files that exceed byte limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 2e9,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 2e9,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    await expect(
        startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 2e9,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("can finish file processing preview size and preview placeholder", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can finish file processing preview size and preview placeholder in any order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: filePreviewPlaceholder,
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can't finish file preview processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(otherSession.action(), {
            width: 100,
            height: 100,
            scale: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    await expect(
        fileUploader.finishProcessingPreviewPlaceholder(
            otherSession.action(),
            filePreviewPlaceholder,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can't finish file preview processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview"));

    await expect(
        fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );
});

test("can't finish file preview processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                },
            }),
        );

        await expect(
            fileUploader.finishProcessingPreviewSize(session.action(), {
                width: 100,
                height: 100,
                scale: 1,
            }),
        ).rejects.toThrow(
            new PermissionDeniedError("File has already finished processing its preview"),
        );
    }

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                },
            }),
        );

        await expect(
            fileUploader.finishProcessingPreviewPlaceholder(
                session.action(),
                filePreviewPlaceholder,
            ),
        ).rejects.toThrow(
            new PermissionDeniedError("File has already finished processing its preview"),
        );
    }
});

test("can't finish file preview processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        await expect(
            fileUploader.finishProcessingPreviewSize(session.action(), {
                width: 100,
                height: 100,
                scale: 1,
            }),
        ).rejects.toThrow(
            new PermissionDeniedError("File has already finished processing its preview size"),
        );
    }

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: false,
            hasPreviewVideoDuration: false,
        });

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        await expect(
            fileUploader.finishProcessingPreviewPlaceholder(
                session.action(),
                filePreviewPlaceholder,
            ),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "File has already finished processing its preview placeholder",
            ),
        );
    }
});

test("can finish file processing preview size, preview placeholder, and preview image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
            },
        }),
    );
});

test("can finish file processing preview size, preview placeholder, and preview image in any order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/tiff",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: filePreviewPlaceholder,
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );
    }

    {
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/tiff",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );
    }
});

test("can't finish file preview image processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(otherSession.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish file preview image processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );
});

test("can't finish file preview image processing for files without a preview image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview image"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can't finish file preview image processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("File has already finished processing its preview"),
    );
});

test("can't finish file preview image processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("File has already finished processing its preview image"),
    );
});

test("can finish file processing preview size, preview placeholder, preview image, and preview video duration", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: 5000,
            },
        }),
    );
});

test("can finish file processing preview size, preview placeholder, preview image, and preview video duration in any order", async () => {
    const actions: Array<(fileUploader: FileUploader, session: TestSession) => Promise<unknown>> = [
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewSize(session.action(), {
                width: 100,
                height: 100,
                scale: 1,
            }),
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewPlaceholder(
                session.action(),
                filePreviewPlaceholder,
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewImage(session.action(), {
                contentType: "image/jpeg",
                contentLength: 110,
                isAlternative: false,
            }),
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000),
    ];

    /**
     * Generate all the permutations of an array. Derived from [StackOverflow][1].
     *
     * [1]: https://stackoverflow.com/a/20871714/1568890
     */
    function permutator<Item>(inputArray: ReadonlyArray<Item>): Array<Array<Item>> {
        const results: Array<Array<Item>> = [];

        const permute = (array: ReadonlyArray<Item>, result: Array<Item> = []) => {
            if (array.length === 0) {
                results.push(result);
            } else {
                for (let i = 0; i < array.length; i++) {
                    const remainingArray = array.slice();
                    const additionalResult = remainingArray.splice(i, 1);
                    permute(remainingArray.slice(), result.concat(additionalResult));
                }
            }
        };

        permute(inputArray);

        return results;
    }

    const actionsPermutations = permutator(actions);

    for (const actions of actionsPermutations) {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/tiff",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                    videoDuration: "Processing",
                },
            }),
        );

        for (const action of actions) {
            await action(fileUploader, session);
        }

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                    videoDuration: 5000,
                },
            }),
        );
    }
});

test("can finish file processing preview size (and video duration), preview placeholder, and preview image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(
        session.action(),
        {
            width: 100,
            height: 100,
            scale: 1,
        },
        {alsoPreviewVideoDuration: 5000},
    );

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: 5000,
            },
        }),
    );

    const {wasUpdated} = await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(
        session.action(),
        5000,
    );

    expect(wasUpdated).toEqual(false);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: 5000,
            },
        }),
    );
});

test("can finish file processing preview size (including video duration), preview placeholder, and preview image in any order", async () => {
    const actions: Array<(fileUploader: FileUploader, session: TestSession) => Promise<unknown>> = [
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewSize(
                session.action(),
                {
                    width: 100,
                    height: 100,
                    scale: 1,
                },
                {alsoPreviewVideoDuration: 5000},
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewPlaceholder(
                session.action(),
                filePreviewPlaceholder,
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingPreviewImage(session.action(), {
                contentType: "image/jpeg",
                contentLength: 110,
                isAlternative: false,
            }),
    ];

    /**
     * Generate all the permutations of an array. Derived from [StackOverflow][1].
     *
     * [1]: https://stackoverflow.com/a/20871714/1568890
     */
    function permutator<Item>(inputArray: ReadonlyArray<Item>): Array<Array<Item>> {
        const results: Array<Array<Item>> = [];

        const permute = (array: ReadonlyArray<Item>, result: Array<Item> = []) => {
            if (array.length === 0) {
                results.push(result);
            } else {
                for (let i = 0; i < array.length; i++) {
                    const remainingArray = array.slice();
                    const additionalResult = remainingArray.splice(i, 1);
                    permute(remainingArray.slice(), result.concat(additionalResult));
                }
            }
        };

        permute(inputArray);

        return results;
    }

    const actionsPermutations = permutator(actions);

    for (const actions of actionsPermutations) {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/tiff",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                    videoDuration: "Processing",
                },
            }),
        );

        for (const action of actions) {
            await action(fileUploader, session);
        }

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                alternative: null,
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                    videoDuration: 5000,
                },
            }),
        );
    }
});

test("can't finish file preview video duration processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewVideoDurationIfNeeded(otherSession.action(), 5000),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish file preview video duration processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );
});

test("can't finish file preview video duration processing for files without a preview video duration", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview video duration"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish file preview video duration processing for files without a preview video duration (setting with preview size)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(
            session.action(),
            {
                width: 100,
                height: 100,
                scale: 1,
            },
            {alsoPreviewVideoDuration: 5000},
        ),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview video duration"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish file preview video duration processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    const {wasUpdated: wasUpdated1} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated1).toEqual(true);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );

    const {wasUpdated: wasUpdated2} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated2).toEqual(false);

    const {wasUpdated: wasUpdated3} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated3).toEqual(false);
});

test("can't finish file preview video duration processing if file processing has already completely finished with different data", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    const {wasUpdated: wasUpdated1} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated1).toEqual(true);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5001),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));

    const {wasUpdated: wasUpdated2} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated2).toEqual(false);
});

test("can finish file preview video duration processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    const {wasUpdated: wasUpdated1} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated1).toEqual(true);

    const {wasUpdated: wasUpdated2} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated2).toEqual(false);

    const {wasUpdated: wasUpdated3} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated3).toEqual(false);
});

test("can't finish file preview video duration processing for the same data twice (setting second time with preview size)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    const {wasUpdated: wasUpdated1} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated1).toEqual(true);

    await expect(
        fileUploader.finishProcessingPreviewSize(
            session.action(),
            {
                width: 100,
                height: 100,
                scale: 1,
            },
            {alsoPreviewVideoDuration: 5000},
        ),
    ).rejects.toThrow(
        new InternalError("File has already finished processing its preview video duration"),
    );
});

test("can't finish file preview video duration processing for the same data twice if the data is different", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
    });

    const {wasUpdated: wasUpdated1} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated1).toEqual(true);

    await expect(
        fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5001),
    ).rejects.toThrow(
        new InternalError("File has already finished processing its preview video duration"),
    );

    const {wasUpdated: wasUpdated2} =
        await fileUploader.finishProcessingPreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(wasUpdated2).toEqual(false);
});

test("can finish file processing preview with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can finish file processing preview with error after processing preview size", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can't finish file with processed preview size after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can't finish file with processed preview placeholder after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can't finish file with processed preview image after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can't finish file processing preview with error twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
        code: ErrorCode.InvalidArgument,
        displayMessage: errorDisplayMessage`Uh oh!`,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
            code: ErrorCode.InvalidArgument,
            displayMessage: errorDisplayMessage`Yikes!`,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: false,
                error: {
                    code: ErrorCode.InvalidArgument,
                    displayMessage: errorDisplayMessage`Uh oh!`,
                },
            },
        }),
    );
});

test("can't finish file preview processing with error with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewAfterAcceptableError(otherSession.action(), {
            code: ErrorCode.InvalidArgument,
            displayMessage: errorDisplayMessage`Uh oh!`,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish file preview processing with error for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
            code: ErrorCode.InvalidArgument,
            displayMessage: errorDisplayMessage`Uh oh!`,
        }),
    ).rejects.toThrow(new InternalError("File doesn't have a preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );
});

test("can't finish file preview processing with error if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/tiff",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewAfterAcceptableError(session.action(), {
            code: ErrorCode.InvalidArgument,
            displayMessage: errorDisplayMessage`Uh oh!`,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its preview"));
});

test("can finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await fileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can't finish file uploading twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await fileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(fileUploader.finishUploading(session.action())).rejects.toThrow(InternalError);
});

test("can't finish file uploading as a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: false,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );

    await expect(fileUploader.finishUploading(otherSession.action())).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: null,
        }),
    );
});

test("can finish file processing then finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );

    await fileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can finish file uploading then finish file processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can finish uploading interleaved with finishing file processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can finish file processing even if a different process updates file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: false,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    const otherFileUploader = new FileUploader({
        partitionType: "Space",
        sortRangeType: "File",
        spaceId: space.id,
        fileId: fileUploader.fileId,
        uploaderId: session.account.id,
        contentType: "image/png",
        contentLength: 100,
        isUploading: true,
        alternative: null,
        preview: {
            isProcessing: true,
            size: "Processing",
            placeholder: "Processing",
        },
    });

    await otherFileUploader.finishUploading(session.action());

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});

test("can finish processing file alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can finish processing file alternative in any order", async () => {
    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
            hasAlternative: true,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
            hasAlternative: true,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
            hasAlternative: true,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isPreviewImage: false,
                },
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }
});

test("can finish processing preview image file alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/heic",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/heic",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/heic",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/heic",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/heic",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "image/avif",
                contentLength: 110,
                isPreviewImage: true,
            },
            preview: {
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can finish processing preview image file alternative in any order", async () => {
    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/heic",
            contentLength: 100,
            hasAlternative: true,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "image/avif",
                    contentLength: 110,
                    isPreviewImage: true,
                },
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "image/avif",
                    contentLength: 110,
                    isPreviewImage: true,
                },
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/heic",
            contentLength: 100,
            hasAlternative: true,
            hasPreview: true,
            hasPreviewImage: true,
            hasPreviewVideoDuration: false,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {isProcessing: true},
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "image/avif",
                    contentLength: 110,
                    isPreviewImage: true,
                },
                preview: {
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "image/avif",
                    contentLength: 110,
                    isPreviewImage: true,
                },
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: "Processing",
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingPreviewPlaceholder(
            session.action(),
            filePreviewPlaceholder,
        );

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/heic",
                contentLength: 100,
                isUploading: true,
                alternative: {
                    isProcessing: false,
                    contentType: "image/avif",
                    contentLength: 110,
                    isPreviewImage: true,
                },
                preview: {
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1},
                    placeholder: filePreviewPlaceholder,
                    image: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }
});

test("can't finish processing file alternative as another account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(otherSession.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish processing file alternative twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its alternative"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish processing file alternative for a file with no alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(new InternalError("File doesn't have an alternative"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish processing an alternative preview image for a file with no alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        }),
    ).rejects.toThrow(new InternalError("File doesn't have an alternative"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});

test("can't finish processing file alternative if preview image is alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "image/avif",
                contentLength: 110,
                isPreviewImage: true,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its alternative"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "image/avif",
                contentLength: 110,
                isPreviewImage: true,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can't finish processing file alternative preview image if alternative is already processed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
        hasAlternative: true,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {isProcessing: true},
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        }),
    ).rejects.toThrow(new InternalError("File has already finished processing its alternative"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: true,
            alternative: {
                isProcessing: false,
                contentType: "application/pdf",
                contentLength: 120,
                isPreviewImage: false,
            },
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );
});
