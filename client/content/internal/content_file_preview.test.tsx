import {render, screen} from "@testing-library/react";
import {ReactNode, useState} from "react";
import {ContentEditor} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {AppContext, AppContextProvider} from "~/client/context/app_context.js";
import {ReactContextModule} from "~/client/context/react_context_module.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {TestSpaceContextProvider} from "~/client/spaces/space_context_provider.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {waitMacrotask} from "~/shared/helpers/async/wait_macrotask.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {getFileSignedUrlFromAttachment} from "~/shared/rpc/files_rpc_definitions.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

import.meta.jest.useFakeTimers();

const schema = DocumentWithoutTitleContentProsemirrorSchema;

const createdTime = new Date();

const space = new SpaceModel({
    id: generateId(),
    version: 0,
    name: "Test Space",
});

const currentAccount = createTestAccountModel({
    id: generateId<AccountId>(),
    version: 0,
    name: "Test Account",
    nameVersion: 0,
    space: {
        version: 0,
        addedTime: createdTime,
        state: {type: "Active"},
        role: "Member",
    },
});

const context: AppContext = Context.new({
    tracer: new TracerContextModule(testTracer),
    rpc: new TestRpcContextModule(),
    react: ReactContextModule.newForClient(),
});

function TestContextProvider({children}: {children: ReactNode}) {
    return (
        <AppContextProvider value={context}>
            <TestSpaceContextProvider initialSpace={space} currentAccount={currentAccount}>
                {children}
            </TestSpaceContextProvider>
        </AppContextProvider>
    );
}

// eslint-disable-next-line testing-library/render-result-naming-convention
const fileAttachmentTarget = markMemoIfNotRendering({
    type: "Document",
    documentId: generateId(),
} as const satisfies FileAttachmentTarget);

// eslint-disable-next-line testing-library/render-result-naming-convention
const commentFileAttachmentTarget = markMemoIfNotRendering({
    type: "DocumentComments",
    documentId: fileAttachmentTarget.documentId,
} as const satisfies FileAttachmentTarget);

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

test("will refresh signed URL when it’s about to expire", async () => {
    const fileId = generateChronologicalId<FileId>();
    const expirationTime1Seconds = Math.round((Date.now() + 1000 * 60 * 2) / 1000);

    const content = schema.node("doc", {}, [
        schema.node("fileRow", {}, [schema.node("file", {fileId})]),
    ]);

    const contentReferences: ContentReferences = {
        ...emptyContentReferences,
        fileById: new Map([
            [
                fileId,
                {
                    signedUrlSearch: `?exp=${expirationTime1Seconds}&sig=test-image-a`,
                    file: new FileModel({
                        id: fileId,
                        contentType: "image/jpeg",
                        contentLength: 1200 ** 2,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 1200, height: 1200, scale: 1, hasAlpha: false},
                            placeholder: fileImagePreviewPlaceholder,
                        },
                    }),
                },
            ],
        ]),
    };

    function TestContentEditor() {
        const [state, setState] = useState(() =>
            ContentEditorState.create({
                doc: content,
                references: contentReferences,
            }),
        );

        return (
            <TestContextProvider>
                <ContentEditor
                    aria-label="Test"
                    state={state}
                    onChange={setState}
                    fileAttachmentTarget={fileAttachmentTarget}
                    commentFileAttachmentTarget={commentFileAttachmentTarget}
                />
            </TestContextProvider>
        );
    }

    render(<TestContentEditor />);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(0);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime1Seconds}&sig=test-image-a&width=600`,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(0);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime1Seconds}&sig=test-image-a&width=600`,
    );

    import.meta.jest.advanceTimersByTime(1000 * 25);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(1);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime1Seconds}&sig=test-image-a&width=600`,
    );

    const expirationTime2Seconds = Math.round((Date.now() + 1000 * 60 * 62) / 1000);

    TestRpcContextModule.resolveLastExecution(getFileSignedUrlFromAttachment, {
        signedUrlSearch: `?exp=${expirationTime2Seconds}&sig=test-image-b`,
    });

    await waitMacrotask();

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(1);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime2Seconds}&sig=test-image-b&width=600`,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60 * 61);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(1);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime2Seconds}&sig=test-image-b&width=600`,
    );

    import.meta.jest.advanceTimersByTime(1000 * 25);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(2);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime2Seconds}&sig=test-image-b&width=600`,
    );

    import.meta.jest.advanceTimersByTime(1000 * 60);

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    const expirationTime3Seconds = Math.round((Date.now() + 1000 * 60 * 62) / 1000);

    TestRpcContextModule.resolveLastExecution(getFileSignedUrlFromAttachment, {
        signedUrlSearch: `?exp=${expirationTime3Seconds}&sig=test-image-c`,
    });

    await waitMacrotask();

    expect(TestRpcContextModule.getExecutions(getFileSignedUrlFromAttachment).length).toEqual(2);
    expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `/files/${space.id}/${fileId}?exp=${expirationTime3Seconds}&sig=test-image-c&width=600`,
    );
});
