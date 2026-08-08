import {RefObject} from "react";
import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {resolveInitialMessageInputState} from "~/client/web/messaging/resolve_initial_message_input_state.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    MessageContentWithReferences,
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";

const spaceId = generateId<SpaceId>();

type RestoreStateRef = RefObject<{
    state: ContentEditorState<MessageContentWithReferences>;
    files: ReadonlyArray<MessageInputFile>;
    isFocused: boolean;
} | null>;

function createTestMessageDraft(text: string, fileIds: MessageDraft["fileIds"] = []): MessageDraft {
    return {
        content: {
            doc: createSimpleMessageContent(text),
            references: emptyContentReferences,
        },
        parent: null,
        fileIds,
        version: zeroHybridLogicalTime,
    };
}

function createRestoreStateRef({text}: {text: string}): {
    restoreStateRef: RestoreStateRef;
    restoreState: NonNullable<RestoreStateRef["current"]>;
} {
    const restoreState = {
        state: ContentEditorState.create({
            spaceId,
            content: {
                doc: createSimpleMessageContent(text),
                references: emptyContentReferences,
            },
        }),
        files: emptyArray,
        isFocused: false,
    };

    return {restoreStateRef: {current: restoreState}, restoreState};
}

describe("resolveInitialMessageInputState()", () => {
    test("creates empty state with no draft or restore stash", () => {
        expect(resolveInitialMessageInputState({spaceId}).state.getDoc().toJSON()).toEqual(
            emptyMessageContent.toJSON(),
        );
    });

    test("creates empty state with no files or draft sync state", () => {
        expect(
            resolveInitialMessageInputState({
                spaceId,
            }),
        ).toMatchObject({
            files: [],
            draftSyncState: null,
        });
    });

    test("creates state from a server draft", () => {
        const fileIds = [generateChronologicalId<FileId>()];
        const draft = createTestMessageDraft("hello", fileIds);

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft,
            })
                .state.getDoc()
                .toJSON(),
        ).toEqual(createSimpleMessageContent("hello").toJSON());
    });

    test("creates state from stash", () => {
        const {restoreStateRef, restoreState} = createRestoreStateRef({text: "restored"});

        expect(
            resolveInitialMessageInputState({
                spaceId,
                restoreStateRef,
            }),
        ).toMatchObject({
            state: restoreState.state,
            files: restoreState.files,
            draftSyncState: {
                lastDraftSent: null,
                hasRemoteDraftContent: false,
            },
        });
    });

    test("sets hasRemoteDraftContent to true when restoring from stash and a server draft is present", () => {
        const {restoreStateRef, restoreState} = createRestoreStateRef({text: "restored"});

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft: createTestMessageDraft("server draft"),
                restoreStateRef,
            }),
        ).toMatchObject({
            state: restoreState.state,
            files: restoreState.files,
            draftSyncState: {
                lastDraftSent: null,
                hasRemoteDraftContent: true,
            },
        });
    });

    test("creates draft sync state from a server draft", () => {
        const fileIds = [generateChronologicalId<FileId>()];
        const draft = createTestMessageDraft("hello", fileIds);

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft,
            }),
        ).toMatchObject({
            files: [],
            draftSyncState: {
                lastDraftSent: {parent: null, fileIds},
                hasRemoteDraftContent: true,
            },
        });
    });

    test("creates files from a hydrated server draft", () => {
        const fileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const draft: MessageDraftWithFiles = {
            ...createTestMessageDraft("hello", [fileId]),
            files: [
                {
                    type: "FileEntity",
                    fileId,
                    fileEntityResult: {ok: false, error: "Not found"},
                },
            ],
        };

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft,
            }),
        ).toMatchObject({
            files: [{type: "FileEntity", fileEntityId: fileId}],
            draftSyncState: {
                lastDraftSent: {fileIds: [fileId]},
                hasRemoteDraftContent: true,
            },
        });
    });

    test("prefers restore stash over a server draft", () => {
        const {restoreStateRef} = createRestoreStateRef({text: "restored"});

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft: createTestMessageDraft("from draft"),
                restoreStateRef,
            })
                .state.getDoc()
                .toJSON(),
        ).toEqual(createSimpleMessageContent("restored").toJSON());
    });

    test("prefers an empty restore stash over a server draft", () => {
        const restoreStateRef: RestoreStateRef = {
            current: {
                state: ContentEditorState.create({
                    spaceId,
                    content: {doc: emptyMessageContent, references: emptyContentReferences},
                }),
                files: emptyArray,
                isFocused: false,
            },
        };

        expect(
            resolveInitialMessageInputState({
                spaceId,
                draft: createTestMessageDraft("from draft"),
                restoreStateRef,
            })
                .state.getDoc()
                .toJSON(),
        ).toEqual(emptyMessageContent.toJSON());
    });
});
