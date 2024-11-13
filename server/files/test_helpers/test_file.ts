import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    FileAuthorizer,
    attachFileAsUploader,
    attachFileFromAttachment,
    getFileAsUploader,
    getFileFromAttachment,
    startUploadingAndProcessingFile,
} from "~/server/files/data/files_table.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId} from "~/shared/id/types/id_types.js";

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
        const fileUploader = await startUploadingAndProcessingFile(session.action(), {
            spaceId: session.space.id,
            contentType: "image/png",
            contentLength: 100,
            hasAlternative: false,
            hasPreview: null,
        });

        await fileUploader.finishUploading(session.action());

        return new TestFile(session.context, session.space, fileUploader.fileId, null);
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
