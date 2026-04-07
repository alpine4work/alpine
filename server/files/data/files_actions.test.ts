import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    FileUploader,
    attachFileAsUploader,
    attachFileFromAttachment,
    detachFile,
    finishUploadingAndStartProcessingFile,
    getFileAsUploader,
    getFileFromAttachment,
    getFileUploaderAsUploader,
    getPostDraftFileAttachments,
    startUploadingFile,
} from "~/server/files/data/files_actions.js";
import {createOrReplacePostDraft} from "~/server/forum/data/create_or_replace_post_draft.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {generateChronologicalId, getChronologicalIdTime} from "~/shared/id/chronological_id.js";
import {PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

const fileImagePreviewPlaceholder1 = new FileImagePreviewPlaceholder([
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

const fileImagePreviewPlaceholder2 = new FileImagePreviewPlaceholder([
    [
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
    ],
    [
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
    ],
    [
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
        {r: 0, g: 255, b: 0},
    ],
]);

const fileCodePreviewContent1 = new FileCodePreviewContent([
    {type: "String", classes: "tok-keyword", string: "let"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName tok-definition", string: "a"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-operator", string: "="},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-number", string: "1"},
    {type: "String", classes: "tok-punctuation", string: ";"},
    {type: "Newline"},
    {type: "String", classes: "tok-keyword", string: "let"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName tok-definition", string: "b"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-operator", string: "="},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-number", string: "2"},
    {type: "String", classes: "tok-punctuation", string: ";"},
    {type: "Newline"},
    {type: "String", classes: "tok-variableName", string: "console"},
    {type: "String", classes: "tok-operator", string: "."},
    {type: "String", classes: "tok-propertyName", string: "log"},
    {type: "String", classes: "tok-punctuation", string: "("},
    {type: "String", classes: "tok-variableName", string: "a"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName", string: "b"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-punctuation", string: ")"},
    {type: "String", classes: "tok-punctuation", string: ";"},
]);

const fileCodePreviewContent2 = new FileCodePreviewContent([
    {type: "String", classes: "tok-keyword", string: "let"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName tok-definition", string: "b"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-operator", string: "="},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-number", string: "2"},
    {type: "String", classes: "tok-punctuation", string: ";"},
    {type: "Newline"},
    {type: "String", classes: "tok-keyword", string: "let"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName tok-definition", string: "a"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-operator", string: "="},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-number", string: "1"},
    {type: "String", classes: "tok-punctuation", string: ";"},
    {type: "Newline"},
    {type: "String", classes: "tok-variableName", string: "console"},
    {type: "String", classes: "tok-operator", string: "."},
    {type: "String", classes: "tok-propertyName", string: "log"},
    {type: "String", classes: "tok-punctuation", string: "("},
    {type: "String", classes: "tok-variableName", string: "b"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-variableName", string: "a"},
    {type: "String", classes: "", string: " "},
    {type: "String", classes: "tok-punctuation", string: ")"},
    {type: "String", classes: "tok-punctuation", string: ";"},
]);

async function uploadAndStartProcessingFile(
    context: ServerSessionActionContext,
    {
        spaceId,
        contentType,
        contentLength,
        attachTargetAuthorizer,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        attachTargetAuthorizer?: FileAuthorizer;
    },
) {
    const {fileId} = await startUploadingFile(context, {
        spaceId,
        contentType,
        contentLength,
        attachTargetAuthorizer,
    });

    await finishUploadingAndStartProcessingFile(context, {spaceId, fileId});

    return getFileUploaderAsUploader(context, spaceId, fileId);
}

test("can start uploading and processing files", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const startTime = Date.now();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );
    }

    {
        const startTime = Date.now();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );
    }

    {
        const startTime = Date.now();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        const endTime = Date.now();

        const idTime = getChronologicalIdTime(fileUploader.fileId);

        expect(idTime).toBeGreaterThanOrEqual(startTime);
        expect(idTime).toBeLessThanOrEqual(endTime);

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
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
        uploadAndStartProcessingFile(session.action(), {
            spaceId: otherSpace.id,
            contentType: "image/png",
            contentLength: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can\u2019t start uploading and processing files that exceed byte limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 1e9,
    });

    await expect(
        uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 1e9,
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can finish file processing preview size and preview placeholder", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );
});

test("can finish file processing preview size and preview placeholder in any order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );
});

test("can\u2019t finish file preview processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const otherSession = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    await otherSpace.addAccount(session);

    const botAccount = await TestBot.createAndInstantiate(session);

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewSize(otherSession.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            otherSession.action(),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            context.anonymousAction(),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            context.impersonatedAccountAction(space.id, otherSession.account.id),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError("Impersonated account actor is not for the file\u2019s space"),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            botAccount.action(),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can finish file preview processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 120,
            height: 120,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );
    }

    {
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder2,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );
    }
});

test("can finish file preview processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 120,
            height: 120,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                },
            }),
        );
    }

    {
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder2,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/png",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: fileImagePreviewPlaceholder1,
                },
            }),
        );
    }
});

test("can finish file processing preview size, preview placeholder, and preview image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {
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
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/pdf",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );
    }

    {
        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/pdf",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/pdf",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                },
            }),
        );
    }
});

test("can\u2019t finish file preview image processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewContent(otherSession.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview image processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can\u2019t finish file preview image processing for files without a preview image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/jpeg",
            contentLength: 110,
            isAlternative: false,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have image preview content"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can finish file preview image processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 120,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );
});

test("can finish file preview image processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "application/pdf",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: {
                    contentType: "application/pdf",
                    contentLength: 110,
                },
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: {
                    contentType: "application/pdf",
                    contentLength: 110,
                },
            },
        }),
    );
});

test("can finish file processing preview size, preview placeholder, preview image, and preview video duration", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {
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
            fileUploader.finishProcessingImagePreviewSize(session.action(), {
                width: 100,
                height: 100,
                scale: 1,
                hasAlpha: false,
            }),
        (fileUploader, session) =>
            fileUploader.finishProcessingImagePreviewPlaceholder(
                session.action(),
                fileImagePreviewPlaceholder1,
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingImagePreviewContent(session.action(), {
                contentType: "image/jpeg",
                contentLength: 110,
                isAlternative: false,
            }),
        (fileUploader, session) =>
            fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000),
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

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "video/webm",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "video/webm",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                    videoDuration: "Processing",
                },
            }),
        );

        for (const action of actions) {
            await action(fileUploader, session);
        }

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "video/webm",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {
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

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(
        session.action(),
        {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        },
        {alsoPreviewVideoDuration: 5000},
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {
                    contentType: "image/jpeg",
                    contentLength: 110,
                },
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {
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
            fileUploader.finishProcessingImagePreviewSize(
                session.action(),
                {
                    width: 100,
                    height: 100,
                    scale: 1,
                    hasAlpha: false,
                },
                {alsoPreviewVideoDuration: 5000},
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingImagePreviewPlaceholder(
                session.action(),
                fileImagePreviewPlaceholder1,
            ),
        (fileUploader, session) =>
            fileUploader.finishProcessingImagePreviewContent(session.action(), {
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

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "video/webm",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "video/webm",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                    videoDuration: "Processing",
                },
            }),
        );

        for (const action of actions) {
            await action(fileUploader, session);
        }

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "video/webm",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {
                        contentType: "image/jpeg",
                        contentLength: 110,
                    },
                    videoDuration: 5000,
                },
            }),
        );
    }
});

test("can\u2019t finish file preview video duration processing with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(otherSession.action(), 5000),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview video duration processing for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can\u2019t finish file preview video duration processing for files without a preview video duration", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a image preview video duration"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview video duration processing for files without a preview video duration (setting with preview size)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewSize(
            session.action(),
            {
                width: 100,
                height: 100,
                scale: 1,
                hasAlpha: false,
            },
            {alsoPreviewVideoDuration: 5000},
        ),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a image preview video duration"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview video duration processing if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5200);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );
});

test("can\u2019t finish file preview video duration processing if file processing has already completely finished with different data", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
                videoDuration: 5000,
            },
        }),
    );
});

test("can finish file preview video duration processing for the same data twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5200);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );
});

test("can\u2019t finish file preview video duration processing for the same data twice (setting second time with preview size)", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(
        session.action(),
        {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        },
        {alsoPreviewVideoDuration: 5100},
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );
});

test("can finish file preview video duration processing for the same data twice even when the data is different", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "video/webm",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 5100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "video/webm",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
                videoDuration: 5000,
            },
        }),
    );
});

test("can finish file processing image preview with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can finish file processing preview with error after processing preview size", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can finish file with processed preview size after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can finish file with processed preview placeholder after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can finish file with processed preview image after processing preview error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can finish file processing preview with error twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "Unknown",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                size: "Error",
                placeholder: "Error",
                content: "Error",
            },
        }),
    );
});

test("can\u2019t finish file preview processing with error with a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewWithError(otherSession.action(), {
            type: "PasswordProtected",
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file preview processing with error for files without a preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingPreviewWithError(session.action(), {
            type: "PasswordProtected",
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can finish file processing audio preview with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                duration: "Error",
                metadata: "Error",
            },
        }),
    );
});

test("can finish file processing code preview with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "text/javascript",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: true,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
                content: "Error",
            },
        }),
    );
});

test("can finish file preview processing with error if file processing has already completely finished", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/jpeg",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );

    await fileUploader.finishProcessingPreviewWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/jpeg", contentLength: 110},
            },
        }),
    );
});

test("can finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await finishUploadingAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        fileId,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t finish file uploading twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await finishUploadingAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        fileId,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        finishUploadingAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            fileId,
        }),
    ).rejects.toThrow(new FailedPreconditionError("File has already finished uploading"));
});

test("can\u2019t finish file uploading as a different account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        finishUploadingAndStartProcessingFile(otherSession.action(), {
            spaceId: space.id,
            fileId,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can finish file processing then finish file uploading", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const fileUploader = await getFileUploaderAsUploader(session.action(), space.id, fileId);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );

    await finishUploadingAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        fileId: fileUploader.fileId,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );
});

test("can finish file uploading then finish file processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const fileUploader = await getFileUploaderAsUploader(session.action(), space.id, fileId);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await finishUploadingAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        fileId: fileUploader.fileId,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );
});

test("can finish uploading interleaved with finishing file processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {fileId} = await startUploadingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const fileUploader = await getFileUploaderAsUploader(session.action(), space.id, fileId);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: true,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
            },
        }),
    );

    await finishUploadingAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        fileId: fileUploader.fileId,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
            },
        }),
    );
});

test("can finish processing file alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can finish processing file alternative in any order", async () => {
    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "application/msword",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "application/msword",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "application/pdf",
                    contentLength: 120,
                    isImagePreviewContent: false,
                },
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }
});

test("can finish processing preview image file alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/heif",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/heif",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewSize(session.action(), {
        width: 100,
        height: 100,
        scale: 1,
        hasAlpha: false,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/heif",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        session.action(),
        fileImagePreviewPlaceholder1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/heif",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: true,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/heif",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: 110,
                isImagePreviewContent: true,
            },
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                placeholder: fileImagePreviewPlaceholder1,
                content: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can finish processing preview image file alternative in any order", async () => {
    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/heif",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "image/avif",
                    contentLength: 110,
                    isImagePreviewContent: true,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "image/avif",
                    contentLength: 110,
                    isImagePreviewContent: true,
                },
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "image/heif",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {isProcessing: true},
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "image/avif",
                    contentLength: 110,
                    isImagePreviewContent: true,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "image/avif",
                    contentLength: 110,
                    isImagePreviewContent: true,
                },
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: "Processing",
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );

        await fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        );

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "image/heif",
                contentLength: 100,
                isUploading: false,
                alternative: {
                    isProcessing: false,
                    ok: true,
                    contentType: "image/avif",
                    contentLength: 110,
                    isImagePreviewContent: true,
                },
                preview: {
                    type: "Image",
                    isProcessing: false,
                    ok: true,
                    size: {width: 100, height: 100, scale: 1, hasAlpha: false},
                    placeholder: fileImagePreviewPlaceholder1,
                    content: {contentType: "image/avif", contentLength: 110},
                },
            }),
        );
    }
});

test("can\u2019t finish processing file alternative as another account", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(otherSession.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 130,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file alternative for a file with no alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternative(session.action(), {
            contentType: "application/pdf",
            contentLength: 120,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an alternative"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing an alternative preview image for a file with no alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/pdf",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/avif",
            contentLength: 110,
            isAlternative: true,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an alternative"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/pdf",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative if preview image is alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: true,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: 110,
                isImagePreviewContent: true,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: 110,
                isImagePreviewContent: true,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: {contentType: "image/avif", contentLength: 110},
            },
        }),
    );
});

test("can finish processing file alternative preview image if alternative is already processed", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "application/pdf",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingImagePreviewContent(session.action(), {
        contentType: "image/avif",
        contentLength: 110,
        isAlternative: true,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "application/pdf",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: {
                    contentType: "image/avif",
                    contentLength: 110,
                },
            },
        }),
    );
});

test("can finish processing file alternative with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative with error twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(session.action(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(session.action(), {
        type: "Unknown",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative with error after finished processing alternative", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "image/avif",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(session.action(), {
        type: "Unknown",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: 120,
                isImagePreviewContent: false,
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative after finished processing alternative with error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(session.action(), {
        type: "Unknown",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternative(session.action(), {
        contentType: "image/avif",
        contentLength: 120,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file alternative with error as the wrong session", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternativeWithError(session2.action(), {
            type: "PasswordProtected",
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file alternative with error as the right system actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAlternativeWithError(space.systemAction(), {
        type: "PasswordProtected",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: false,
                error: {type: "PasswordProtected"},
            },
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file alternative with error as the wrong system actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternativeWithError(otherSpace.systemAction(), {
            type: "PasswordProtected",
        }),
    ).rejects.toThrow(new PermissionDeniedError("System actor is not for the file\u2019s space"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file alternative with error as an anonymous actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/msword",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAlternativeWithError(context.anonymousAction(), {
            type: "PasswordProtected",
        }),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/msword",
            contentLength: 100,
            isUploading: false,
            alternative: {isProcessing: true},
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
                content: "Processing",
            },
        }),
    );
});

test("can finish processing file audio preview", async () => {
    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "audio/mpeg",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: true,
                    duration: "Processing",
                    metadata: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000);

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: true,
                    duration: 2000,
                    metadata: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
            title: "A",
            artist: "B",
            album: "C",
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: false,
                    ok: true,
                    duration: 2000,
                    metadata: {
                        title: "A",
                        artist: "B",
                        album: "C",
                    },
                },
            }),
        );
    }

    {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const fileUploader = await uploadAndStartProcessingFile(session.action(), {
            spaceId: space.id,
            contentType: "audio/mpeg",
            contentLength: 100,
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: true,
                    duration: "Processing",
                    metadata: "Processing",
                },
            }),
        );

        await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
            title: "A",
            artist: "B",
            album: "C",
        });

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: true,
                    duration: "Processing",
                    metadata: {
                        title: "A",
                        artist: "B",
                        album: "C",
                    },
                },
            }),
        );

        await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000);

        expect(
            await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId),
        ).toEqual(
            new FileModel({
                spaceId: space.id,
                id: fileUploader.fileId,
                contentType: "audio/mpeg",
                contentLength: 100,
                isUploading: false,
                alternative: null,
                preview: {
                    type: "Audio",
                    isProcessing: false,
                    ok: true,
                    duration: 2000,
                    metadata: {
                        title: "A",
                        artist: "B",
                        album: "C",
                    },
                },
            }),
        );
    }
});

test("can\u2019t finish processing file audio preview duration with the wrong session", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewDuration(otherSession.action(), 2000),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can finish processing file audio preview duration twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: 2000,
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: 2000,
                metadata: "Processing",
            },
        }),
    );
});

test("can finish processing file audio preview duration when preview is finished processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: 2000,
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
        title: "A",
        artist: "B",
        album: "C",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: true,
                duration: 2000,
                metadata: {
                    title: "A",
                    artist: "B",
                    album: "C",
                },
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2100);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: true,
                duration: 2000,
                metadata: {
                    title: "A",
                    artist: "B",
                    album: "C",
                },
            },
        }),
    );
});

test("can\u2019t finish processing file audio preview duration for file without preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can\u2019t finish processing file audio preview duration for file with an image preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an audio preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file audio preview metadata with the wrong session", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewMetadata(otherSession.action(), {
            title: "A",
            artist: "B",
            album: "C",
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can finish processing file audio preview metadata twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
        title: "A1",
        artist: "B1",
        album: "C1",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: {
                    title: "A1",
                    artist: "B1",
                    album: "C1",
                },
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
        title: "A2",
        artist: "B2",
        album: "C2",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: {
                    title: "A1",
                    artist: "B1",
                    album: "C1",
                },
            },
        }),
    );
});

test("can finish processing file audio preview metadata when preview is finished processing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewDuration(session.action(), 2000);

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: 2000,
                metadata: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
        title: "A1",
        artist: "B1",
        album: "C1",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: true,
                duration: 2000,
                metadata: {
                    title: "A1",
                    artist: "B1",
                    album: "C1",
                },
            },
        }),
    );

    await fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
        title: "A2",
        artist: "B2",
        album: "C2",
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: false,
                ok: true,
                duration: 2000,
                metadata: {
                    title: "A1",
                    artist: "B1",
                    album: "C1",
                },
            },
        }),
    );
});

test("can\u2019t finish processing file audio preview metadata for file without preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
            title: "A",
            artist: "B",
            album: "C",
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can\u2019t finish processing file audio preview metadata for file with an image preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingAudioPreviewMetadata(session.action(), {
            title: "A",
            artist: "B",
            album: "C",
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an audio preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file image preview size for file with an audio preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewSize(session.action(), {
            width: 100,
            height: 100,
            scale: 1,
            hasAlpha: false,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an image preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file image preview placeholder for file with an audio preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewPlaceholder(
            session.action(),
            fileImagePreviewPlaceholder1,
        ),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an image preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file image preview content for file with an audio preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewContent(session.action(), {
            contentType: "image/webp",
            contentLength: 200,
            isAlternative: false,
        }),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an image preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can\u2019t finish processing file image preview video duration for file with an audio preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "audio/mpeg",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(session.action(), 3000),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have an image preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "audio/mpeg",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Audio",
                isProcessing: true,
                duration: "Processing",
                metadata: "Processing",
            },
        }),
    );
});

test("can finish processing file code preview content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "text/javascript",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: true,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingCodePreviewContent(
        session.action(),
        fileCodePreviewContent1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: false,
                ok: true,
                content: fileCodePreviewContent1,
            },
        }),
    );
});

test("can\u2019t finish processing file code preview content with the wrong session", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "text/javascript",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: true,
                content: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingCodePreviewContent(
            otherSession.action(),
            fileCodePreviewContent1,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account is not the file\u2019s uploader account"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: true,
                content: "Processing",
            },
        }),
    );
});

test("can finish processing code preview content duration twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "text/javascript",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: true,
                content: "Processing",
            },
        }),
    );

    await fileUploader.finishProcessingCodePreviewContent(
        session.action(),
        fileCodePreviewContent1,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: false,
                ok: true,
                content: fileCodePreviewContent1,
            },
        }),
    );

    await fileUploader.finishProcessingCodePreviewContent(
        session.action(),
        fileCodePreviewContent2,
    );

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "text/javascript",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Code",
                isProcessing: false,
                ok: true,
                content: fileCodePreviewContent1,
            },
        }),
    );
});

test("can\u2019t finish processing file code preview content for file without preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "application/octet-stream",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );

    await expect(
        fileUploader.finishProcessingCodePreviewContent(session.action(), fileCodePreviewContent1),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "application/octet-stream",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    );
});

test("can\u2019t finish processing file code preview content for file with an image preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        fileUploader.finishProcessingCodePreviewContent(session.action(), fileCodePreviewContent1),
    ).rejects.toThrow(new InternalError("File doesn\u2019t have a code preview"));

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("system action from the wrong space can\u2019t access file", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        getFileAsUploader(otherSpace.systemAction(), space.id, fileUploader.fileId),
    ).rejects.toThrow(new PermissionDeniedError("System actor doesn\u2019t have access to space"));
});

test("only the uploader account can access their file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const otherSession = await space.createSession();

    const otherSpace = await TestSpace.create(context);
    await otherSpace.addAccount(session);

    const botAccount = await TestBot.createAndInstantiate(session);

    const fileUploader = await uploadAndStartProcessingFile(session.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(await getFileAsUploader(space.systemAction(), space.id, fileUploader.fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        getFileAsUploader(otherSession.action(), space.id, fileUploader.fileId),
    ).rejects.toThrow(new PermissionDeniedError("Account didn\u2019t upload file"));

    await expect(
        getFileAsUploader(context.anonymousAction(), space.id, fileUploader.fileId),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));

    await expect(
        getFileAsUploader(
            context.impersonatedAccountAction(space.id, otherSession.account.id),
            space.id,
            fileUploader.fileId,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account didn\u2019t upload file"));

    await expect(
        getFileAsUploader(
            context.impersonatedAccountAction(otherSpace.id, session.account.id),
            space.id,
            fileUploader.fileId,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError("Impersonated account actor doesn\u2019t have access to space"),
    );

    await expect(
        getFileAsUploader(botAccount.action(), space.id, fileUploader.fileId),
    ).rejects.toThrow(new PermissionDeniedError("Account didn\u2019t upload file"));
});

test("can get file from attachment after it\u2019s been attached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session1.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can get file from attachment if the file doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            generateChronologicalId(),
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new NotFoundError("File not found"));
});

test("can\u2019t get file from attachment if you don\u2019t have access to the attachment target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        getFileFromAttachment(
            session3.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));

    await expect(
        getFileFromAttachment(
            otherSession.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        getFileFromAttachment(
            otherSpace.systemAction(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("System actor doesn\u2019t have access to space"));

    await attachFileAsUploader(
        session1.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        getFileFromAttachment(
            session3.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));

    await expect(
        getFileFromAttachment(
            otherSession.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        getFileFromAttachment(
            otherSpace.systemAction(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("System actor doesn\u2019t have access to space"));
});

test("can\u2019t attach file as uploader if not the uploader", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileAsUploader(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account didn\u2019t upload file"));

    await expect(
        attachFileAsUploader(
            otherSession.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(
        new PermissionDeniedError("Account doesn\u2019t have access to space (and 1 other error)"),
    );

    await expect(
        attachFileAsUploader(
            otherSpace.systemAction(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("System actor doesn\u2019t have access to space"));

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        getFileFromAttachment(
            context.anonymousAction(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));
});

test("can\u2019t attach file if you don\u2019t have view access to the target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const fileUploader = await uploadAndStartProcessingFile(session3.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileAsUploader(
            session3.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));
});

test("can\u2019t attach file if you don\u2019t have edit access to the target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const channel = await TestChannel.create(session1);
    const post1 = await channel.createPost(session1);
    const post2 = await channel.createPost(session2);

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post2.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileAsUploader(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have edit access to post"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FilePostAuthorizer.bind({type: "Post", postId: post2.id}),
    );

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post2.id}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can attach file to new target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session1);

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileFromAttachment(session1.action(), space.id, fileUploader.fileId, {
            from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileFromAttachment(session1.action(), space.id, fileUploader.fileId, {
        from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
    });

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can attach file to new target as the uploader", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session2);

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileFromAttachment(session2.action(), space.id, fileUploader.fileId, {
            from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileFromAttachment(session2.action(), space.id, fileUploader.fileId, {
        from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
    });

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t attach file to new target if you don\u2019t have edit access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session2);

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileFromAttachment(session1.action(), space.id, fileUploader.fileId, {
            from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        }),
    ).rejects.toThrow(
        new PermissionDeniedError("File isn\u2019t attached to target (and 1 other error)"),
    );

    await expect(
        attachFileFromAttachment(session2.action(), space.id, fileUploader.fileId, {
            from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileFromAttachment(session1.action(), space.id, fileUploader.fileId, {
            from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
            to: FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have edit access to post"));

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));
});

test("can\u2019t attach file to new target you don\u2019t have access to", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const channel = await TestChannel.create(session1);
    const post1 = await channel.createPost(session2);
    const post2 = await channel.createPost(session3);

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
    );

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await expect(
        attachFileFromAttachment(session3.action(), space.id, fileUploader.fileId, {
            from: FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
            to: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    await expect(
        getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileFromAttachment(session3.action(), space.id, fileUploader.fileId, {
        from: FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
        to: FilePostAuthorizer.bind({type: "Post", postId: post2.id}),
    });
});

test("can get file from attachment after it\u2019s been attached when starting upload", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        attachTargetAuthorizer: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    });

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t get file from attachment if you don\u2019t have access to the attachment target after attach when starting upload", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const fileUploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
        attachTargetAuthorizer: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    });

    expect(
        await getFileFromAttachment(
            session2.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        getFileFromAttachment(
            session3.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `View` access level"));

    await expect(
        getFileFromAttachment(
            otherSession.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

    await expect(
        getFileFromAttachment(
            otherSpace.systemAction(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("System actor doesn\u2019t have access to space"));
});

test("can\u2019t attach file when uploading if you don\u2019t have view access to the target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        uploadAndStartProcessingFile(session3.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            attachTargetAuthorizer: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));
});

test("can\u2019t attach file when uploading if you don\u2019t have edit access to the target", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    const post1 = await channel.createPost(session1);

    await expect(
        uploadAndStartProcessingFile(session2.action(), {
            spaceId: space.id,
            contentType: "image/png",
            contentLength: 100,
            attachTargetAuthorizer: FilePostAuthorizer.bind({type: "Post", postId: post1.id}),
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have edit access to post"));
});

test("can detach file as uploader", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await detachFile(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));
});

test("can detach file as non-uploader", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await detachFile(
        session1.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));
});

test("can\u2019t detach file without view access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        detachFile(
            session3.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Actor doesn’t have `Edit` access level"));

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );
});

test("can\u2019t detach file without edit access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const fileUploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const channel = await TestChannel.create(session1);
    const post = await channel.createPost(session2);

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));

    await attachFileAsUploader(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FilePostAuthorizer.bind({type: "Post", postId: post.id}),
    );

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await expect(
        detachFile(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have edit access to post"));

    expect(
        await getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileUploader.fileId,
            contentType: "image/png",
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
        }),
    );

    await detachFile(
        session2.action(),
        space.id,
        fileUploader.fileId,
        FilePostAuthorizer.bind({type: "Post", postId: post.id}),
    );

    await expect(
        getFileFromAttachment(
            session1.action(),
            space.id,
            fileUploader.fileId,
            FilePostAuthorizer.bind({type: "Post", postId: post.id}),
        ),
    ).rejects.toThrow(new PermissionDeniedError("File isn\u2019t attached to target"));
});

test("can get all files attached to post draft", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chatId = await getOrCreateChatForAccounts(session2.action(), {
        spaceId: space.id,
        otherAccountIds: [session1.account.id],
    });

    const file1Uploader = await uploadAndStartProcessingFile(session2.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const file2Uploader = await uploadAndStartProcessingFile(session1.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    const draftId = generateChronologicalId<PostDraftId>();

    expect(
        await getPostDraftFileAttachments(
            session1.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).toEqual([]);

    await createOrReplacePostDraft(session1.action(), space.id, session1.account.id, draftId, {
        channelId: null,
        content: createSimplePostContent("Test Post 1"),
    });

    expect(
        await getPostDraftFileAttachments(
            session1.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).toEqual([]);

    await expect(
        getPostDraftFileAttachments(
            session2.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Can\u2019t access drafts from other accounts"));

    await attachFileAsUploader(
        session1.action(),
        space.id,
        file2Uploader.fileId,
        FilePostAuthorizer.bind({type: "PostDraft", accountId: session1.account.id, draftId}),
    );

    expect(
        await getPostDraftFileAttachments(
            session1.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).toEqual([file2Uploader.fileId]);

    await attachFileAsUploader(
        session2.action(),
        space.id,
        file1Uploader.fileId,
        FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
    );

    expect(
        await getPostDraftFileAttachments(
            session1.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).toEqual([file2Uploader.fileId]);

    await attachFileFromAttachment(session1.action(), space.id, file1Uploader.fileId, {
        from: FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
        to: FilePostAuthorizer.bind({type: "PostDraft", accountId: session1.account.id, draftId}),
    });

    expect(
        await getPostDraftFileAttachments(
            session1.action(),
            space.id,
            session1.account.id,
            draftId,
            FilePostAuthorizer,
        ),
    ).toEqual([file1Uploader.fileId, file2Uploader.fileId]);
});

test("bot can upload file", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const botAccount = await TestBot.createAndInstantiate(session);

    const {fileId} = await startUploadingFile(botAccount.action(), {
        spaceId: space.id,
        contentType: "image/png",
        contentLength: 100,
    });

    expect(
        (await getFileAsUploader(space.systemAction(), space.id, fileId)).initialData.isUploading,
    ).toEqual(true);

    await finishUploadingAndStartProcessingFile(botAccount.action(), {
        spaceId: space.id,
        fileId,
    });

    expect(
        (await getFileAsUploader(space.systemAction(), space.id, fileId)).initialData.isUploading,
    ).toEqual(false);
});
