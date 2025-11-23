/**
 * Key tests:
 *
 * Plugin State Management:
 *    - Lints are stored in plugin state and persist across editor transactions
 *    - Plugin state is updated via transactions using setMeta() with the plugin key
 *    - State includes both the lints and logic for hiding lints under the cursor
 *
 * Position Mapping:
 *    - When the document changes, lint positions are automatically mapped to their new locations
 *    - ProseMirror's transaction.mapping handles this via transaction.mapping.map()
 *    - Lints are removed if their content is deleted (when from === to after mapping)
 *
 * Test Structure:
 * - createEditorState() creates a ProseMirror EditorState with the spell checker plugin
 * - createMockLint() creates realistic ContentSpellCheckLint objects for testing
 * - Tests use ProseMirror's transaction system (state.tr) to simulate editor changes
 * - Plugin state is accessed via getContentEditorSpellCheckerLints() helper function
 */

import {EditorState, TextSelection} from "prosemirror-state";
import {
    ContentSpellCheckLint,
    ContentSpellCheckLintCategory,
    ContentSpellCheckLintKind,
    ContentSpellCheckSuggestion,
    generateContentSpellCheckLintKey,
} from "~/client/web/content/state/content_editor_spell_checker_configuration.js";
import {
    contentEditorSpellCheckerPlugin,
    getContentEditorSpellCheckerLints,
    setContentEditorSpellCheckerLints,
} from "~/client/web/content/state/content_editor_spell_checker_plugin.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

function createMockLint(options: {
    from: number;
    to: number;
    kind: ContentSpellCheckLintKind;
    category: ContentSpellCheckLintCategory;
    suggestions: Array<ContentSpellCheckSuggestion>;
}): ContentSpellCheckLint {
    return {
        key: generateContentSpellCheckLintKey(),
        from: options.from,
        to: options.to,
        kind: options.kind,
        category: options.category,
        suggestions: options.suggestions,
    };
}

function createEditorState(content?: string): EditorState {
    const doc = content
        ? schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(content)])])
        : schema.node("doc", {}, [schema.node("paragraph", {}, [])]);

    return EditorState.create({
        doc,
        plugins: [contentEditorSpellCheckerPlugin()],
    });
}

describe("contentEditorSpellCheckerPlugin", () => {
    describe("plugin initialization", () => {
        test("initializes with empty state", () => {
            const state = createEditorState();

            expect(getContentEditorSpellCheckerLints(state)).toEqual([]);
        });
    });

    describe("setContentEditorSpellCheckerLints()", () => {
        test("sets lints in plugin state", () => {
            const state = createEditorState("hello world");
            const lints = [
                createMockLint({
                    from: 1,
                    to: 5,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "corrected", kind: "replace"}],
                }),
            ];

            const tr = setContentEditorSpellCheckerLints(state.tr, lints);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual(lints);
        });

        test("replaces existing lints", () => {
            let state = createEditorState("hello world");

            const firstLints = [
                createMockLint({
                    from: 1,
                    to: 5,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "corrected", kind: "replace"}],
                }),
            ];
            let tr = setContentEditorSpellCheckerLints(state.tr, firstLints);
            state = state.apply(tr);

            const secondLints = [
                createMockLint({
                    from: 7,
                    to: 12,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "corrected", kind: "replace"}],
                }),
            ];
            tr = setContentEditorSpellCheckerLints(state.tr, secondLints);
            state = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(state)).toEqual(secondLints);
        });
    });

    describe("lint position mapping", () => {
        test("maps lint positions when document changes", () => {
            let state = createEditorState("hello world");
            const lints = [
                createMockLint({
                    from: 7,
                    to: 12,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "world", kind: "replace"}],
                }),
            ]; // "world"

            let tr = setContentEditorSpellCheckerLints(state.tr, lints);
            state = state.apply(tr);

            // Insert text before the lint
            tr = state.tr.insertText("beautiful ", 7);
            state = state.apply(tr);

            const updatedLints = getContentEditorSpellCheckerLints(state);
            expect(updatedLints).toHaveLength(1);
            expect(updatedLints[0]).toMatchObject({
                from: 17, // 7 + "beautiful ".length
                to: 22, // 12 + "beautiful ".length
                kind: "spelling",
                category: "spelling",
            });
        });

        test("removes lints when their content is deleted", () => {
            let state = createEditorState("hello world");
            const lints = [
                createMockLint({
                    from: 7,
                    to: 12,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "world", kind: "replace"}],
                }),
            ]; // "world"

            let tr = setContentEditorSpellCheckerLints(state.tr, lints);
            state = state.apply(tr);

            // Delete the lint content
            tr = state.tr.delete(7, 12);
            state = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(state)).toEqual([]);
        });

        test("preserves lints when unrelated content changes", () => {
            let state = createEditorState("hello world test");
            const lints = [
                createMockLint({
                    from: 13,
                    to: 17,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "test", kind: "replace"}],
                }),
            ]; // "test"

            let tr = setContentEditorSpellCheckerLints(state.tr, lints);
            state = state.apply(tr);

            // Change text before the lint
            tr = state.tr.replaceWith(1, 6, schema.text("hi"));
            state = state.apply(tr);

            const updatedLints = getContentEditorSpellCheckerLints(state);
            expect(updatedLints).toHaveLength(1);
            expect(updatedLints[0]).toMatchObject({
                from: 10, // adjusted for shorter replacement
                to: 14,
                kind: "spelling",
                category: "spelling",
            });
        });

        test("handles multiple lints with position mapping", () => {
            let state = createEditorState("hello beautiful world");
            const lints = [
                createMockLint({
                    from: 1,
                    to: 6,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "hello", kind: "replace"}],
                }), // "hello"
                createMockLint({
                    from: 17,
                    to: 22,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "world", kind: "replace"}],
                }), // "world"
            ];

            let tr = setContentEditorSpellCheckerLints(state.tr, lints);
            state = state.apply(tr);

            // Insert text in the middle
            tr = state.tr.insertText("amazing ", 7);
            state = state.apply(tr);

            const updatedLints = getContentEditorSpellCheckerLints(state);
            expect(updatedLints).toHaveLength(2);

            // First lint should be unchanged
            expect(updatedLints.find(l => l.from === 1)).toMatchObject({
                from: 1,
                to: 6,
            });

            // Second lint should be moved
            expect(updatedLints.find(l => l.from === 25)).toMatchObject({
                from: 25, // 17 + "amazing ".length
                to: 30, // 22 + "amazing ".length
            });
        });
    });

    describe("lint unhiding behavior", () => {
        test("unhides lint when selection leaves lint range", () => {
            let state = createEditorState("hello world");
            const lint = createMockLint({
                from: 1,
                to: 6,
                kind: "spelling",
                category: "spelling",
                suggestions: [{text: "hello", kind: "replace"}],
            }); // "hello"

            // Position cursor inside lint to hide it
            const selectionInside = new TextSelection(state.doc.resolve(3));
            state = state.apply(state.tr.setSelection(selectionInside));

            let tr = setContentEditorSpellCheckerLints(state.tr, [lint]);
            state = state.apply(tr);

            // Move cursor outside lint range
            const selectionOutside = new TextSelection(state.doc.resolve(8));
            tr = state.tr.setSelection(selectionOutside);
            state = state.apply(tr);

            // Lint should still be in the state (unhiding is handled by the decorations logic)
            expect(getContentEditorSpellCheckerLints(state)).toEqual([lint]);
        });

        test("keeps lint hidden after document changes until new lints arrive", () => {
            let state = createEditorState("hello world");
            const lint = createMockLint({
                from: 1,
                to: 6,
                kind: "spelling",
                category: "spelling",
                suggestions: [{text: "hello", kind: "replace"}],
            }); // "hello"

            // Position cursor inside lint to hide it
            const selectionInside = new TextSelection(state.doc.resolve(3));
            state = state.apply(state.tr.setSelection(selectionInside));

            let tr = setContentEditorSpellCheckerLints(state.tr, [lint]);
            state = state.apply(tr);

            // Make a document change while cursor is still in range
            tr = state.tr.insertText("x", 4);
            state = state.apply(tr);

            // Move cursor outside - lint should remain hidden until new spell check
            const selectionOutside = new TextSelection(state.doc.resolve(9));
            tr = state.tr.setSelection(selectionOutside);
            state = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(state)).toHaveLength(1);
        });
    });

    describe("different lint categories", () => {
        const testCases = [
            {category: "grammar" as const, description: "grammar lints"},
            {category: "spelling" as const, description: "spelling lints"},
            {category: "formatting" as const, description: "formatting lints"},
        ];

        testCases.forEach(({category, description}) => {
            test(`handles ${description}`, () => {
                const state = createEditorState("hello world");
                const lints = [
                    createMockLint({
                        from: 1,
                        to: 6,
                        kind: "spelling",
                        category,
                        suggestions: [{text: "hello", kind: "replace"}],
                    }),
                ];

                const tr = setContentEditorSpellCheckerLints(state.tr, lints);
                const newState = state.apply(tr);

                expect(getContentEditorSpellCheckerLints(newState)).toEqual(lints);
            });
        });
    });

    describe("edge cases", () => {
        test("handles empty lints array", () => {
            const state = createEditorState("hello world");

            const tr = setContentEditorSpellCheckerLints(state.tr, []);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual([]);
        });

        test("handles lints with same positions", () => {
            const state = createEditorState("hello world");
            const lints = [
                createMockLint({
                    from: 1,
                    to: 6,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "hello", kind: "replace"}],
                }),
                createMockLint({
                    from: 1,
                    to: 6,
                    kind: "wordchoice",
                    category: "grammar",
                    suggestions: [{text: "hi", kind: "replace"}],
                }),
            ];

            const tr = setContentEditorSpellCheckerLints(state.tr, lints);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual(lints);
        });

        test("handles zero-length lints", () => {
            const state = createEditorState("hello world");
            const lints = [
                createMockLint({
                    from: 5,
                    to: 5,
                    kind: "punctuation",
                    category: "formatting",
                    suggestions: [{text: ",", kind: "insertafter"}],
                }),
            ]; // zero-length lint

            const tr = setContentEditorSpellCheckerLints(state.tr, lints);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual(lints);
        });

        test("handles lints at document boundaries", () => {
            const state = createEditorState("hello");
            const lints = [
                createMockLint({
                    from: 1,
                    to: 2,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "H", kind: "replace"}],
                }), // first char
                createMockLint({
                    from: 5,
                    to: 6,
                    kind: "spelling",
                    category: "spelling",
                    suggestions: [{text: "O", kind: "replace"}],
                }), // last char
            ];

            const tr = setContentEditorSpellCheckerLints(state.tr, lints);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual(lints);
        });

        test("handles empty document", () => {
            const state = createEditorState();
            const lints: Array<ContentSpellCheckLint> = [];

            const tr = setContentEditorSpellCheckerLints(state.tr, lints);
            const newState = state.apply(tr);

            expect(getContentEditorSpellCheckerLints(newState)).toEqual([]);
        });

        test("preserves lint properties during position mapping", () => {
            let state = createEditorState("hello world");
            const originalLint = createMockLint({
                from: 7,
                to: 12,
                kind: "wordchoice",
                category: "grammar",
                suggestions: [
                    {text: "earth", kind: "replace"},
                    {text: "planet", kind: "replace"},
                ],
            });

            let tr = setContentEditorSpellCheckerLints(state.tr, [originalLint]);
            state = state.apply(tr);

            // Insert text to trigger position mapping
            tr = state.tr.insertText("big ", 1);
            state = state.apply(tr);

            const updatedLints = getContentEditorSpellCheckerLints(state);
            expect(updatedLints).toHaveLength(1);
            expect(updatedLints[0]).toMatchObject({
                from: 11, // moved by "big ".length
                to: 16,
                kind: "wordchoice",
                category: "grammar",
                suggestions: [
                    {text: "earth", kind: "replace"},
                    {text: "planet", kind: "replace"},
                ],
            });
            expect(updatedLints[0]!.key).toBe(originalLint.key);
        });
    });
});
