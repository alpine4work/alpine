/* eslint-disable cyberworlds/string-quotes */

import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {getCollaborativeContentEditorStatePersistedContent} from "~/client/web/content/collaborative_content_editor_state.js";
import {
    getInitialTaskNotesContentEditorState,
    reduceTaskNotesContentEditorState,
} from "~/client/web/tasks/task_detail_notes_content_editor_state.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ContentEditorClientId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskNotesContent,
    assertTaskNotesContent,
    TaskNotesContentProsemirrorSchema as schema,
} from "~/shared/tasks/task_notes_content_schema.js";

const spaceId = generateId<SpaceId>();
const taskId = generateId<TaskId>();

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

function notesContent(text: string): TaskNotesContent {
    return assertTaskNotesContent(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(text)])]),
    );
}

function getInitialState(text: string, version: number) {
    return getInitialTaskNotesContentEditorState({
        spaceId,
        taskId,
        initialNotesVersion: version,
        initialNotesContent: {doc: notesContent(text), references: emptyContentReferences},
    });
}

test("remembers the content before each received step", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialState("abc", 10);

    expect(state.extra.rememberedSteps.length).toEqual(0);

    state = reduceTaskNotesContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(4, 4, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(1);
    expect(state.extra.rememberedSteps[0]!.contentBeforeStep.get().toString()).toEqual(
        'doc(paragraph("abc"))',
    );
});

test("discards remembered steps once they are persisted", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialState("abc", 10);

    state = reduceTaskNotesContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(4, 4, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(5, 5, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(2);

    state = reduceTaskNotesContentEditorState(state, [{type: "Persisted", newVersion: 12}]);

    expect(state.extra.rememberedSteps.length).toEqual(0);
});

test("reconstructs the persisted content from remembered steps", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialState("abc", 10);

    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(paragraph("abc"))',
    );

    state = reduceTaskNotesContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(4, 4, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(5, 5, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
    ]);

    // The editor advanced to version 12 but the database is still at version 10, so
    // the persisted content is still the original "abc".
    expect(state.editorState.getVersion()).toEqual(12);
    expect(state.persistedVersion).toEqual(10);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(paragraph("abc"))',
    );

    state = reduceTaskNotesContentEditorState(state, [{type: "Persisted", newVersion: 11}]);

    // Now the database is at version 11 ("abcd") but the editor remains at version 12.
    expect(state.persistedVersion).toEqual(11);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(paragraph("abcd"))',
    );
});

test("resets to the persisted version, dropping unpersisted steps", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialState("abc", 10);

    function resetToPersistedVersion() {
        const newState = reduceTaskNotesContentEditorState(state, [
            {type: "Extra", extra: {type: "ResetToPersistedVersion"}},
        ]);

        // Resetting recreates the editor state with a fresh client id.
        expect(newState.editorState.getClientId()).not.toEqual(state.editorState.getClientId());

        return {
            persistedVersion: newState.persistedVersion,
            version: newState.editorState.getVersion(),
            doc: newState.editorState.getContent().doc.toString(),
        };
    }

    expect(resetToPersistedVersion()).toEqual({
        persistedVersion: 10,
        version: 10,
        doc: 'doc(paragraph("abc"))',
    });

    state = reduceTaskNotesContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(4, 4, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(5, 5, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyContentReferences,
        },
    ]);

    // We received steps but nothing was persisted, so resetting rolls all the way back
    // to the original persisted version 10.
    expect(resetToPersistedVersion()).toEqual({
        persistedVersion: 10,
        version: 10,
        doc: 'doc(paragraph("abc"))',
    });

    state = reduceTaskNotesContentEditorState(state, [{type: "Persisted", newVersion: 11}]);

    // After the database advances to version 11, resetting only rolls back to "abcd".
    expect(resetToPersistedVersion()).toEqual({
        persistedVersion: 11,
        version: 11,
        doc: 'doc(paragraph("abcd"))',
    });
});
