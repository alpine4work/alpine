import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {
    getInitialDocumentContentEditorState,
    reduceDocumentContentEditorState,
} from "~/client/documents/internal/document_content_editor_state";
import {
    assertDocumentContent,
    DocumentContentProsemirrorSchema as schema,
} from "~/shared/content/document_content_schema";
import {generateId} from "~/shared/id/id";
import {ContentEditorClientId} from "~/shared/id/types/id_types";
import {DocumentModel, emptyDocumentContentReferences} from "~/shared/models/document_model";

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text)), 0, 0);
}

test("can receive steps one at a time", () => {
    const otherClientId = generateId<ContentEditorClientId>();

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("ab")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 10,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, [schema.text("abc")]),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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

    let state = getInitialDocumentContentEditorState(
        new DocumentModel({
            id: generateId(),
            createdTime: new Date(),
            spaceId: generateId(),
            version: 0,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {}, [
                        schema.node("title", {}, []),
                        schema.node("paragraph", {}, []),
                    ]),
                ),
                references: emptyDocumentContentReferences,
            },
        }),
    );

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
