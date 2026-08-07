import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {applyServerMessageDraftToInputState} from "~/client/web/messaging/apply_server_message_draft_to_input_state.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

const spaceId = generateId<SpaceId>();

function createTestMessageDraft(
    text: string,
    {
        fileIds = [],
        parent = null,
    }: {
        fileIds?: MessageDraft["fileIds"];
        parent?: MessageContentPayloadParent | null;
    } = {},
): MessageDraft {
    return {
        content: {
            doc: createSimpleMessageContent(text),
            references: emptyContentReferences,
        },
        parent,
        fileIds,
        version: zeroHybridLogicalTime,
    };
}

describe("applyServerMessageDraftToInputState()", () => {
    test("uses stored file ids for draft sync state", () => {
        const fileIds = [generateChronologicalId<FileId>()];
        const serverDraft = createTestMessageDraft("hello", {fileIds});
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });

        const result = applyServerMessageDraftToInputState({
            serverDraft,
            spaceId,
            currentState,
            currentParent: null,
            currentFileIds: [],
        });

        expect(result).toMatchObject({
            type: "Apply",
            draftSyncState: {lastDraftSent: {fileIds}},
        });
    });

    test("applies a newer draft to an untouched input", () => {
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });
        const serverDraft = createTestMessageDraft("hello");

        const result = applyServerMessageDraftToInputState({
            serverDraft,
            spaceId,
            currentState,
            currentParent: null,
            currentFileIds: [],
        });

        expect(result.type).toBe("Apply");
        if (result.type !== "Apply") return;

        // Compare doc JSON — see describe-block comment on `ContentEditorState`.
        expect({
            isCollaborative: result.state.isCollaborative(),
            doc: result.state.getDoc().toJSON(),
        }).toEqual({
            isCollaborative: false,
            doc: createSimpleMessageContent("hello").toJSON(),
        });
    });

    test("does not replace content for an empty draft on a fresh input", () => {
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });
        const serverDraft = createTestMessageDraft("");

        const result = applyServerMessageDraftToInputState({
            serverDraft,
            spaceId,
            currentState,
            currentParent: null,
            currentFileIds: [],
        });

        // Don't pass `ContentEditorState` directly to `toMatchObject()`. Jest
        // deep-compares matched properties, and editor state wraps ProseMirror objects
        // with circular references, which can recurse until the test process OOMs
        expect(result).toMatchObject({
            type: "Apply",
            parentToApply: null,
        });
        assert(result.type === "Apply");
        expect(result.state).toBe(currentState);
    });

    test("adopts the reply target from a reply-only draft", () => {
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });
        const serverDraft = createTestMessageDraft("", {parent: {type: "Message", index: 2}});

        const result = applyServerMessageDraftToInputState({
            serverDraft,
            spaceId,
            currentState,
            currentParent: null,
            currentFileIds: [],
        });

        // Don't pass `ContentEditorState` directly to `toMatchObject()`. Jest
        // deep-compares matched properties, and editor state wraps ProseMirror objects
        // with circular references, which can recurse until the test process OOMs
        expect(result).toMatchObject({
            type: "Apply",
            parentToApply: {type: "Message", index: 2},
        });
        assert(result.type === "Apply");
        expect(result.state).toBe(currentState);
    });

    test("keeps local edits when the input already has draft content", () => {
        const localState = ContentEditorState.create({
            spaceId,
            content: {
                doc: createSimpleMessageContent("local"),
                references: emptyContentReferences,
            },
        });
        const serverDraft = createTestMessageDraft("server");

        expect(
            applyServerMessageDraftToInputState({
                serverDraft,
                spaceId,
                currentState: localState,
                currentParent: null,
                currentFileIds: [],
            }),
        ).toMatchObject({type: "LocalWins"});
    });

    test("applies hydrated files from a draft when there is no local content", () => {
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });
        const fileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const serverDraft: MessageDraftWithFiles = {
            ...createTestMessageDraft("", {fileIds: [fileId]}),
            files: [
                {
                    type: "FileEntity",
                    fileId,
                    fileEntityResult: {ok: false, error: "Not found"},
                },
            ],
        };

        expect(
            applyServerMessageDraftToInputState({
                serverDraft,
                spaceId,
                currentState,
                currentParent: null,
                currentFileIds: [],
            }),
        ).toMatchObject({
            type: "Apply",
            files: [{type: "FileEntity", fileEntityId: fileId}],
        });
    });

    test("applies hydrated files and draft content when the input is empty", () => {
        const currentState = ContentEditorState.create({
            spaceId,
            content: {doc: emptyMessageContent, references: emptyContentReferences},
        });
        const fileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const serverDraft: MessageDraftWithFiles = {
            ...createTestMessageDraft("server message draft", {fileIds: [fileId]}),
            files: [
                {
                    type: "FileEntity",
                    fileId,
                    fileEntityResult: {ok: false, error: "Not found"},
                },
            ],
        };

        const result = applyServerMessageDraftToInputState({
            serverDraft,
            spaceId,
            currentState,
            currentParent: null,
            currentFileIds: [],
        });

        expect(result).toMatchObject({
            type: "Apply",
            parentToApply: null,
            files: [{type: "FileEntity", fileEntityId: fileId}],
        });
        if (result.type !== "Apply") return;
        // Compare doc JSON — `result.state` is a new editor state, not `currentState`.
        expect(result.state.getDoc().toJSON()).toEqual(
            createSimpleMessageContent("server message draft").toJSON(),
        );
    });

    test("applies hydrated files without overwriting local content", () => {
        const fileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const localState = ContentEditorState.create({
            spaceId,
            content: {
                doc: createSimpleMessageContent("hello"),
                references: emptyContentReferences,
            },
        });
        const serverDraft: MessageDraftWithFiles = {
            ...createTestMessageDraft("hello", {fileIds: [fileId]}),
            files: [
                {
                    type: "FileEntity",
                    fileId,
                    fileEntityResult: {ok: false, error: "Not found"},
                },
            ],
        };

        expect(
            applyServerMessageDraftToInputState({
                serverDraft,
                spaceId,
                currentState: localState,
                currentParent: null,
                currentFileIds: [],
            }),
        ).toMatchObject({
            type: "ApplyFiles",
            files: [{type: "FileEntity", fileEntityId: fileId}],
            draftSyncState: {lastDraftSent: null, hasRemoteDraftContent: true},
        });
    });

    test("does not overwrite existing files when hydrating late-arriving draft files", () => {
        const serverFileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const localFileId = `Document:${generateId<DocumentId>()}` as FileEntityId;
        const localState = ContentEditorState.create({
            spaceId,
            content: {
                doc: createSimpleMessageContent("hello"),
                references: emptyContentReferences,
            },
        });
        const serverDraft: MessageDraftWithFiles = {
            ...createTestMessageDraft("hello", {fileIds: [serverFileId]}),
            files: [
                {
                    type: "FileEntity",
                    fileId: serverFileId,
                    fileEntityResult: {ok: false, error: "Not found"},
                },
            ],
        };

        expect(
            applyServerMessageDraftToInputState({
                serverDraft,
                spaceId,
                currentState: localState,
                currentParent: null,
                currentFileIds: [localFileId],
            }),
        ).toMatchObject({type: "LocalWins"});
    });
});
