import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileUploader,
    getFile,
    startUploadingAndProcessingFile,
} from "~/server/files/data/files_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    FailedPreconditionError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
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
            hasPreview: true,
            hasPreviewImage: false,
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
            hasPreview: true,
            hasPreviewImage: false,
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
            hasPreview: true,
            hasPreviewImage: false,
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
            hasPreview: true,
            hasPreviewImage: false,
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 2e9,
        hasPreview: true,
        hasPreviewImage: false,
    });

    await expect(
        startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 2e9,
            hasPreview: true,
            hasPreviewImage: false,
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: filePreviewPlaceholder,
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(otherSession.action(), {width: 100, height: 100}),
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
        hasPreview: false,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100}),
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
            hasPreview: true,
            hasPreviewImage: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
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
                preview: {
                    isProcessing: false,
                    size: {width: 100, height: 100},
                    placeholder: filePreviewPlaceholder,
                },
            }),
        );

        await expect(
            fileUploader.finishProcessingPreviewSize(session.action(), {
                width: 100,
                height: 100,
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
            hasPreview: true,
            hasPreviewImage: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
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
                preview: {
                    isProcessing: false,
                    size: {width: 100, height: 100},
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
            hasPreview: true,
            hasPreviewImage: false,
        });

        await fileUploader.finishProcessingPreviewSize(session.action(), {
            width: 100,
            height: 100,
        });

        await expect(
            fileUploader.finishProcessingPreviewSize(session.action(), {
                width: 100,
                height: 100,
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
            hasPreview: true,
            hasPreviewImage: false,
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
        hasPreview: true,
        hasPreviewImage: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
                placeholder: filePreviewPlaceholder,
                image: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
            hasPreview: true,
            hasPreviewImage: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
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
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
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

        await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                preview: {
                    isProcessing: false,
                    size: {width: 100, height: 100},
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
            hasPreview: true,
            hasPreviewImage: true,
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
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
        });

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
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

        await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

        expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
            new FileModel({
                id: fileUploader.fileId,
                contentType: "image/tiff",
                contentLength: 100,
                isUploading: true,
                preview: {
                    isProcessing: true,
                    size: {width: 100, height: 100},
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
                preview: {
                    isProcessing: false,
                    size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: true,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
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
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file's uploader account"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
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
        hasPreview: false,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
        }),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
        }),
    ).rejects.toThrow(new PermissionDeniedError("File doesn't have a preview image"));

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
        hasPreview: true,
        hasPreviewImage: true,
    });

    await fileUploader.finishProcessingPreviewSize(session.action(), {
        width: 100,
        height: 100,
    });

    await fileUploader.finishProcessingPreviewPlaceholder(session.action(), filePreviewPlaceholder);

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/tiff",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
                placeholder: filePreviewPlaceholder,
                image: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
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
        hasPreview: true,
        hasPreviewImage: true,
    });

    await fileUploader.finishProcessingPreviewImage(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
    });

    await expect(
        fileUploader.finishProcessingPreviewImage(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("File has already finished processing its preview image"),
    );
});

test("can finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasPreview: false,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
        hasPreview: false,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
            preview: null,
        }),
    );

    await expect(fileUploader.finishUploading(session.action())).rejects.toThrow(
        FailedPreconditionError,
    );
});

test("can't finish file uploading as a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasPreview: false,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
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
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
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
        hasPreview: true,
        hasPreviewImage: false,
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewSize(session.action(), {width: 100, height: 100});

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: true,
                size: {width: 100, height: 100},
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
            preview: {
                isProcessing: false,
                size: {width: 100, height: 100},
                placeholder: filePreviewPlaceholder,
            },
        }),
    );
});
