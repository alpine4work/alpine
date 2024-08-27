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
                    size: null,
                    placeholder: null,
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
                    size: null,
                    placeholder: null,
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
                    size: null,
                    placeholder: null,
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
    });

    await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 2e9,
        hasPreview: true,
    });

    await expect(
        startUploadingAndProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 2e9,
            hasPreview: true,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                placeholder: null,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                size: null,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                size: null,
                placeholder: null,
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

test("can finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await startUploadingAndProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        hasPreview: false,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                placeholder: null,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                size: null,
                placeholder: null,
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
                placeholder: null,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                placeholder: null,
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
                placeholder: null,
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
    });

    expect(await getFile(space.systemAction(), fileUploader.fileId)).toEqual(
        new FileModel({
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            preview: {
                isProcessing: true,
                size: null,
                placeholder: null,
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
                placeholder: null,
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
            size: null,
            placeholder: null,
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
                placeholder: null,
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
