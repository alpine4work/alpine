/* eslint-disable cyberworlds/string-quotes */

import {Fragment, Slice} from "prosemirror-model";
import {Selection, TextSelection, Transaction} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {getCollaborativeContentEditorStatePersistedContent} from "~/client/web/content/collaborative_content_editor_state.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {
    DocumentContentEditorAction,
    DocumentContentEditorState,
    getInitialDocumentContentEditorState,
    reduceDocumentContentEditorState,
    reduceDocumentContentReferences,
} from "~/client/web/documents/internal/document_content_editor_state.js";
import {ContentSelectionWrapper} from "~/shared/content/content_selection_schema.js";
import {
    DocumentContentWithReferences,
    emptyDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    assertDocumentContent,
    DocumentContentProsemirrorSchema as schema,
    DocumentContentStepSchema as stepSchema,
} from "~/shared/documents/document_content_schema.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, ContentEditorClientId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const spaceId = generateId<SpaceId>();
const currentAccountId = generateId<AccountId>();

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

test("can receive steps one at a time", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [{step: new ReplaceStep(9, 9, textSlice("g")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefg")]),
            ])
            .toJSON(),
    );
});

test("can receive multiple steps at a time", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("d")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdd")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 22,
            steps: [
                {step: new ReplaceStep(8, 8, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(16, 16, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(17, 17, textSlice("e")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeee")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 23,
            steps: [{step: new ReplaceStep(18, 18, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeeef")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 26,
            steps: [
                {step: new ReplaceStep(19, 19, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(20, 20, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(21, 21, textSlice("g")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeeefggg")]),
            ])
            .toJSON(),
    );
});

test("can receive steps out of order", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("ab")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 15,
            steps: [{step: new ReplaceStep(9, 9, textSlice("g")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(5, 5, textSlice("c")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(11);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(13);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(15);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefg")]),
            ])
            .toJSON(),
    );
});

test("can receive steps multiple times", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(11);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(12);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(12);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(12);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(13);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [{step: new ReplaceStep(9, 9, textSlice("g")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(14);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefg")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(14);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefg")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(14);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefg")]),
            ])
            .toJSON(),
    );
});

test("can receive large step backfill with duplicate steps at end of backfill", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 23,
            steps: [{step: new ReplaceStep(18, 18, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 26,
            steps: [
                {step: new ReplaceStep(19, 19, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(20, 20, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(21, 21, textSlice("g")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 26,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(8, 8, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(16, 16, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(17, 17, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(18, 18, textSlice("f")), clientId: otherClientId},
                {step: new ReplaceStep(19, 19, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(20, 20, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(21, 21, textSlice("g")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(26);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeeefggg")]),
            ])
            .toJSON(),
    );
});

test("can receive large step backfill with duplicate steps at beginning of backfill", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 22,
            steps: [
                {step: new ReplaceStep(8, 8, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(16, 16, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(17, 17, textSlice("e")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 26,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(8, 8, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(16, 16, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(17, 17, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(18, 18, textSlice("f")), clientId: otherClientId},
                {step: new ReplaceStep(19, 19, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(20, 20, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(21, 21, textSlice("g")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(26);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeeefggg")]),
            ])
            .toJSON(),
    );
});

test("can receive large step backfill with duplicate steps in the middle of backfill", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("d")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(12);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdd")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 26,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(8, 8, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(16, 16, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(17, 17, textSlice("e")), clientId: otherClientId},
                {step: new ReplaceStep(18, 18, textSlice("f")), clientId: otherClientId},
                {step: new ReplaceStep(19, 19, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(20, 20, textSlice("g")), clientId: otherClientId},
                {step: new ReplaceStep(21, 21, textSlice("g")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(26);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcddeeeeeeeeeefggg")]),
            ])
            .toJSON(),
    );
});

test("reproduce receive steps assertion failure", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 0,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, []),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 1,
            steps: [{step: new ReplaceStep(3, 3, textSlice("h")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(1);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("h")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 2,
            steps: [{step: new ReplaceStep(4, 4, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(2);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("he")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 3,
            steps: [{step: new ReplaceStep(5, 5, textSlice("l")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(3);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("hel")]),
            ])
            .toJSON(),
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [
                {step: new ReplaceStep(6, 6, textSlice("l")), clientId: otherClientId},
                {step: new ReplaceStep(7, 7, textSlice("o")), clientId: otherClientId},
                {step: new ReplaceStep(8, 8, textSlice(",")), clientId: otherClientId},
                {step: new ReplaceStep(9, 9, textSlice(" ")), clientId: otherClientId},
                {step: new ReplaceStep(10, 10, textSlice("w")), clientId: otherClientId},
                {step: new ReplaceStep(11, 11, textSlice("o")), clientId: otherClientId},
                {step: new ReplaceStep(12, 12, textSlice("r")), clientId: otherClientId},
                {step: new ReplaceStep(13, 13, textSlice("l")), clientId: otherClientId},
                {step: new ReplaceStep(14, 14, textSlice("d")), clientId: otherClientId},
                {step: new ReplaceStep(15, 15, textSlice("!")), clientId: otherClientId},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(13);
    expect(state.editorState.getDoc().toJSON()).toEqual(
        schema
            .node("doc", {}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("hello, world!")]),
            ])
            .toJSON(),
    );
});

// Bug found by our `document_collaboration.spec.ts` test.
test("collaborative update scenario", () => {
    const client1Id = generateId<ContentEditorClientId>();
    const client2Id = generateId<ContentEditorClientId>();

    const actions: Array<DocumentContentEditorAction> = [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [
                {
                    clientId: client1Id,
                    step: stepSchema.deserialize({
                        stepType: "replace",
                        from: 14,
                        to: 14,
                        slice: {content: [{type: "text", text: "6"}]},
                    }),
                },
                {
                    clientId: client1Id,
                    step: stepSchema.deserialize({
                        stepType: "replace",
                        from: 15,
                        to: 15,
                        slice: {content: [{type: "text", text: "1"}]},
                    }),
                },
                {
                    clientId: client1Id,
                    step: stepSchema.deserialize({
                        stepType: "replace",
                        from: 16,
                        to: 16,
                        slice: {content: [{type: "text", text: "2"}]},
                    }),
                },
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ];

    const doc = assertDocumentContent(
        schema.nodeFromJSON({
            type: "doc",
            content: [
                {type: "title"},
                {type: "paragraph", content: [{type: "text", text: "1a23bc45def61234"}]},
            ],
        }),
    );

    const collabPluginVersion = 11;

    const editorState = ContentEditorState.createCollaborative<DocumentContentWithReferences>({
        spaceId: null,
        version: collabPluginVersion,
        content: {doc, references: emptyDocumentContentReferences},
        reduceReferences: reduceDocumentContentReferences,
        clientId: client1Id,
    });

    const createTransaction = (): Transaction => (editorState as any)._state.tr;

    const collabPluginUnconfirmed = [
        {
            step: {
                stepType: "replace",
                from: 14,
                to: 14,
                slice: {content: [{type: "text", text: "6"}]},
            },
            inverted: {
                stepType: "replace",
                from: 14,
                to: 14,
                slice: {content: [{type: "text", text: "6"}]},
            },
        },
        {
            step: {
                stepType: "replace",
                from: 15,
                to: 15,
                slice: {content: [{type: "text", text: "1"}]},
            },
            inverted: {
                stepType: "replace",
                from: 15,
                to: 15,
                slice: {content: [{type: "text", text: "1"}]},
            },
        },
        {
            step: {
                stepType: "replace",
                from: 16,
                to: 16,
                slice: {content: [{type: "text", text: "2"}]},
            },
            inverted: {
                stepType: "replace",
                from: 16,
                to: 16,
                slice: {content: [{type: "text", text: "2"}]},
            },
        },
        {
            step: {
                stepType: "replace",
                from: 17,
                to: 17,
                slice: {content: [{type: "text", text: "3"}]},
            },
            inverted: {
                stepType: "replace",
                from: 17,
                to: 17,
                slice: {content: [{type: "text", text: "3"}]},
            },
        },
        {
            step: {
                stepType: "replace",
                from: 18,
                to: 18,
                slice: {content: [{type: "text", text: "4"}]},
            },
            inverted: {
                stepType: "replace",
                from: 18,
                to: 18,
                slice: {content: [{type: "text", text: "4"}]},
            },
        },
    ].map(({step, inverted}) => ({
        origin: createTransaction(),
        step: stepSchema.deserialize(step),
        inverted: stepSchema.deserialize(inverted),
    }));

    {
        const sendableSteps = editorState.sendableSteps();
        expect(sendableSteps?.version).toEqual(undefined);
        expect(sendableSteps?.steps.length).toEqual(undefined);
    }

    // Manually update our collab plugin's `unconfirmed` state since there's no easy
    // way to initialize it with the `prosemirror-collab` API.
    // https://github.com/ProseMirror/prosemirror-collab/blob/c019e4cd1e05504d403d98e6bfec67fe1a80c895/src/collab.ts#L43
    (editorState as any)._state.collab$.unconfirmed = collabPluginUnconfirmed;

    {
        const sendableSteps = editorState.sendableSteps();
        expect(sendableSteps?.version).toEqual(collabPluginVersion);
        expect(sendableSteps?.steps.length).toEqual(collabPluginUnconfirmed.length);
    }

    const oldState: DocumentContentEditorState = {
        spaceId,
        persistedVersion: 0,
        pendingActions: [
            {
                type: "ReceiveSteps",
                newVersion: 16,
                steps: [
                    {
                        clientId: client2Id,
                        step: stepSchema.deserialize({
                            stepType: "replace",
                            from: 17,
                            to: 17,
                            slice: {content: [{type: "text", text: "a"}]},
                        }),
                    },
                    {
                        clientId: client2Id,
                        step: stepSchema.deserialize({
                            stepType: "replace",
                            from: 18,
                            to: 18,
                            slice: {content: [{type: "text", text: "b"}]},
                        }),
                    },
                ],
                stepsContentReferences: emptyDocumentContentReferences,
            },
        ],
        editorState,
        pendingSendableSteps: {
            version: 8,
            clientId: client1Id,
            origins: [createTransaction(), createTransaction(), createTransaction()],
            steps: [
                stepSchema.deserialize({
                    stepType: "replace",
                    from: 11,
                    to: 11,
                    slice: {content: [{type: "text", text: "6"}]},
                }),
                stepSchema.deserialize({
                    stepType: "replace",
                    from: 12,
                    to: 12,
                    slice: {content: [{type: "text", text: "1"}]},
                }),
                stepSchema.deserialize({
                    stepType: "replace",
                    from: 13,
                    to: 13,
                    slice: {content: [{type: "text", text: "2"}]},
                }),
            ],
        },
        errorState: {hasError: false},
        extra: {
            currentAccountId,
            accessLevel: "Manage",
            pendingCreateCommentThreads: [],
            pendingIntentionallyUpdateAccessPolicy: null,
            pendingIntentionallyUpdateDeletedTime: null,
            rememberedSteps: [],
            ourPresenceState: {
                version: 8,
                selection: Selection.fromJSON(doc, {type: "text", anchor: 14, head: 14}),
            },
            otherPresenceStateByConnectionId: ImmutableMap.empty(),
            unpersistedResolutionStateByCommentThreadId: new Map(),
        },
    };

    const newState = reduceDocumentContentEditorState(oldState, actions);

    expect(newState.pendingSendableSteps?.version).toEqual(16);
    expect(newState.extra.ourPresenceState?.version).toEqual(16);
});

test("generates correct remembered steps", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    const doc = assertDocumentContent(
        schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abc")]),
        ]),
    );

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc,
            references: emptyDocumentContentReferences,
        },
    });

    state = {
        ...state,
        extra: {
            ...state.extra,
            otherPresenceStateByConnectionId: ImmutableMap.from([
                [
                    generateId(),
                    {
                        version: 10,
                        selection: ContentSelectionWrapper.new(
                            new TextSelection(doc.resolve(4), doc.resolve(4)),
                        ),
                    },
                ],
            ]),
        },
    };

    expect(state.extra.rememberedSteps.length).toEqual(0);
    expectRememberedSteps();

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(1);
    expectRememberedSteps();

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
        {
            type: "Persisted",
            newVersion: 12,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(2);
    expectRememberedSteps();

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(3);
    expectRememberedSteps();

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [{step: new ReplaceStep(9, 9, textSlice("g")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
        {
            type: "Persisted",
            newVersion: 13,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(4);
    expectRememberedSteps();

    function expectRememberedSteps() {
        for (let i = 0; i < state.extra.rememberedSteps.length; i++) {
            if (i !== 0) {
                expect(state.extra.rememberedSteps[i]!.contentBeforeStep.get().toJSON()).toEqual(
                    state.extra.rememberedSteps[i - 1]!.contentAfterStep.get().toJSON(),
                );
            }

            if (i !== state.extra.rememberedSteps.length - 1) {
                expect(state.extra.rememberedSteps[i]!.contentAfterStep.get().toJSON()).toEqual(
                    state.extra.rememberedSteps[i + 1]!.contentBeforeStep.get().toJSON(),
                );
            }
        }
    }
});

test("can reset to persisted version", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    const doc = assertDocumentContent(
        schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abc")]),
        ]),
    );

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc,
            references: emptyDocumentContentReferences,
        },
    });

    expect(state.extra.rememberedSteps.length).toEqual(0);

    function testResetToPersistedVersion() {
        const newState = reduceDocumentContentEditorState(state, [
            {
                type: "Extra",
                extra: {type: "ResetToPersistedVersion"},
            },
        ]);

        // Make sure we actually reset our state.
        expect(newState.editorState.getClientId()).not.toEqual(state.editorState.getClientId());

        return {
            persistedVersion: newState.persistedVersion,
            version: newState.editorState.getVersion(),
            doc: newState.editorState.getContent().doc,
        };
    }

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 10,
        version: 10,
        doc,
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 11,
            steps: [{step: new ReplaceStep(6, 6, textSlice("d")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(1);

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 10,
        version: 10,
        doc,
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 12,
            steps: [{step: new ReplaceStep(7, 7, textSlice("e")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(2);

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 10,
        version: 10,
        doc,
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 13,
            steps: [{step: new ReplaceStep(8, 8, textSlice("f")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
        {
            type: "Persisted",
            newVersion: 12,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(1);

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 12,
        version: 12,
        doc: schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abcde")]),
        ]),
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 14,
            steps: [{step: new ReplaceStep(9, 9, textSlice("g")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(2);

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 12,
        version: 12,
        doc: schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abcde")]),
        ]),
    });

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 15,
            steps: [{step: new ReplaceStep(10, 10, textSlice("h")), clientId: otherClientId}],
            stepsContentReferences: emptyDocumentContentReferences,
        },
        {
            type: "Persisted",
            newVersion: 15,
        },
    ]);

    expect(state.extra.rememberedSteps.length).toEqual(0);

    expect(testResetToPersistedVersion()).toEqual({
        persistedVersion: 15,
        version: 15,
        doc: schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abcdefgh")]),
        ]),
    });
});

test("setting presence state to a version we don't have remembered steps for doesn't break remembered steps", () => {
    const client1Id = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Manage",
        initialVersion: 10,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("initial")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    expect(state.editorState.getVersion()).toEqual(10);
    expect(state.persistedVersion).toEqual(10);
    expect(state.extra.rememberedSteps.length).toEqual(0);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(title, paragraph("initial"))',
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "ReceiveSteps",
            newVersion: 15,
            steps: [
                {step: new ReplaceStep(10, 10, textSlice(" content")), clientId: client1Id},
                {step: new ReplaceStep(18, 18, textSlice(" more")), clientId: client1Id},
                {step: new ReplaceStep(23, 23, textSlice(" text")), clientId: client1Id},
                {step: new ReplaceStep(28, 28, textSlice(" here")), clientId: client1Id},
                {step: new ReplaceStep(33, 33, textSlice("!")), clientId: client1Id},
            ],
            stepsContentReferences: emptyDocumentContentReferences,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(15);
    expect(state.persistedVersion).toEqual(10);
    expect(state.extra.rememberedSteps.length).toEqual(5);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(title, paragraph("initial"))',
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "Persisted",
            newVersion: 13,
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(15);
    expect(state.persistedVersion).toEqual(13);
    expect(state.extra.rememberedSteps.length).toEqual(2);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(title, paragraph("initial content more text"))',
    );

    state = reduceDocumentContentEditorState(state, [
        {
            type: "Extra",
            extra: {
                type: "SetAllOtherPresenceStates",
                stateByConnectionId: ImmutableMap.from([
                    [
                        generateId(),
                        {
                            version: 12,
                            selection: ContentSelectionWrapper.new(
                                new TextSelection(
                                    state.editorState.getDoc().resolve(5),
                                    state.editorState.getDoc().resolve(5),
                                ),
                            ),
                        },
                    ],
                ]),
            },
        },
    ]);

    expect(state.editorState.getVersion()).toEqual(15);
    expect(state.persistedVersion).toEqual(13);
    expect(state.extra.rememberedSteps.length).toEqual(2);
    expect(getCollaborativeContentEditorStatePersistedContent(state).toString()).toEqual(
        'doc(title, paragraph("initial content more text"))',
    );
});

// Pins down the reducer's "clear empty cursor in read-only mode" branch. In a
// read-only `<ContentEditor>` the browser doesn't render a cursor for an empty
// selection (it only renders selected ranges), so broadcasting an empty-selection
// presence to other clients is wasted state. The reducer relies on
// `state.extra.accessLevel` to decide — if the parent component recreates the
// editor state with a stale `accessLevel`, this branch will misbehave.

test("ourPresenceState is cleared when accessLevel is below Edit and selection is empty", () => {
    const initialState = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "View",
        initialVersion: 0,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    expect(initialState.editorState.getSelection().empty).toBe(true);

    // `UnclearOurPresenceState` would normally restore presence to the editor's
    // current selection. With `accessLevel: "View"` and an empty selection, the
    // post-reduce branch should immediately strip it back to null.
    const state = reduceDocumentContentEditorState(initialState, [
        {type: "Extra", extra: {type: "UnclearOurPresenceState"}},
    ]);

    expect(state.extra.ourPresenceState).toBeNull();
});

test("ourPresenceState is preserved when accessLevel is Edit even with an empty selection", () => {
    const initialState = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "Edit",
        initialVersion: 0,
        initialContent: {
            doc: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("abc")]),
                ]),
            ),
            references: emptyDocumentContentReferences,
        },
    });

    expect(initialState.editorState.getSelection().empty).toBe(true);

    const state = reduceDocumentContentEditorState(initialState, [
        {type: "Extra", extra: {type: "UnclearOurPresenceState"}},
    ]);

    // Edit access keeps the empty-selection presence — editable `<ContentEditor>`
    // renders cursors for empty selections, so other clients should see them.
    expect(state.extra.ourPresenceState).not.toBeNull();
    expect(state.extra.ourPresenceState?.selection.empty).toBe(true);
});

test("ourPresenceState is preserved when accessLevel is below Edit but selection is non-empty", () => {
    const doc = assertDocumentContent(
        schema.node("doc", {}, [
            schema.node("title", {}, []),
            schema.node("paragraph", {}, [schema.text("abc")]),
        ]),
    );
    const initialState = getInitialDocumentContentEditorState({
        spaceId,
        currentAccountId,
        accessLevel: "View",
        initialVersion: 0,
        initialContent: {doc, references: emptyDocumentContentReferences},
        // Select the "abc" range explicitly so the editor's selection is non-empty.
        initialSelection: TextSelection.create(doc, 3, 6),
    });

    expect(initialState.editorState.getSelection().empty).toBe(false);

    const state = reduceDocumentContentEditorState(initialState, [
        {type: "Extra", extra: {type: "UnclearOurPresenceState"}},
    ]);

    // Read-only `<ContentEditor>` _does_ render a non-empty selection range, so we
    // keep the presence — only empty cursor selections get stripped.
    expect(state.extra.ourPresenceState).not.toBeNull();
    expect(state.extra.ourPresenceState?.selection.empty).toBe(false);
});
