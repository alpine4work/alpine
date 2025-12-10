import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
    finishUploadingAndStartProcessingFile,
    getFileAsUploader,
    getFileFromAttachment,
    getFileUploaderAsUploader,
    startUploadingFile,
} from "~/server/files/data/files_actions.js";
import {testFileContent} from "~/server/files/test_helpers/internal/test_file_content.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {TestContext, TestSessionActionContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

const testFileImagePreviewPlaceholder = new FileImagePreviewPlaceholder([
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

export async function uploadTestFile(context: TestSessionActionContext, spaceId: SpaceId) {
    const {fileId} = await startUploadingFile(context, {
        spaceId,
        contentType: "image/png",
        contentLength: testFileContent.length,
    });

    // If we're not using `TestEmptyCloudflareR2Client` then actually upload a file
    // to Cloudflare R2 matching the file in DynamoDB.
    if (!context.r2.isEmptyForTest()) {
        await context.r2.PutObject({
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}`,
            Body: testFileContent,
        });
    }

    await finishUploadingAndStartProcessingFile(context, {
        spaceId,
        fileId,
        // We manually finish processing the file below.
        withoutProcessJobForTest: true,
    });

    const fileUploader = await getFileUploaderAsUploader(context, spaceId, fileId);

    await fileUploader.finishProcessingImagePreviewSize(context, {
        width: 1000,
        height: 1000,
        scale: 1,
        hasAlpha: false,
    });

    await fileUploader.finishProcessingImagePreviewPlaceholder(
        context,
        testFileImagePreviewPlaceholder,
    );

    return {fileId};
}

export class TestFile {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly id: FileId;
    private readonly _fromAuthorizer: FileAuthorizer | null;

    private constructor(
        context: TestContext,
        space: TestSpace,
        id: FileId,
        fromAuthorizer: FileAuthorizer | null,
    ) {
        this.context = context;
        this.space = space;
        this.id = id;
        this._fromAuthorizer = fromAuthorizer;
    }

    public static async create(session: TestSpaceSession): Promise<TestFile> {
        const {fileId} = await uploadTestFile(
            session.context.action(session, {serviceName: "EdgeService"}),
            session.space.id,
        );

        return new TestFile(session.context, session.space, fileId, null);
    }

    public get(): Promise<FileModel> {
        return getFileAsUploader(this.space.systemAction(), this.space.id, this.id);
    }

    public async from(session: TestSession, fileAuthorizer: FileAuthorizer): Promise<TestFile> {
        // Test that the file actually exists, is attached to the provided
        // `FileAuthorizer`, and that the session has access to the `FileAuthorizer`'s
        // target. If these conditions are true we can create a `TestFile` from the
        // `FileAuthorizer` target.
        await getFileFromAttachment(session.action(), this.space.id, this.id, fileAuthorizer);

        return new TestFile(this.context, this.space, this.id, fileAuthorizer);
    }

    public async attach(session: TestSession, fileAuthorizer: FileAuthorizer) {
        if (this._fromAuthorizer === null) {
            await attachFileAsUploader(session.action(), this.space.id, this.id, fileAuthorizer);
        } else {
            await attachFileFromAttachment(session.action(), this.space.id, this.id, {
                from: this._fromAuthorizer,
                to: fileAuthorizer,
            });
        }
    }
}
