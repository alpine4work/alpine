import {EditorState, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ContentEditorSpellChecker} from "~/client/web/content/internal/content_editor_spell_checker.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {ReactContextModule} from "~/client/web/context/react_context_module.js";
import {searchWordTypingDebounceMs} from "~/client/web/search/core/search_word_typing_debounce_ms.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TestRpcContextModule} from "~/shared/rpc/test_rpc_context_module.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

function createMockEditorView(content: string = "hello world"): EditorView {
    const doc = schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(content)])]);

    let state = EditorState.create({
        doc,
    });

    const view = {
        get state() {
            return state;
        },
        dispatch: import.meta.jest.fn((transaction: Transaction) => {
            state = state.apply(transaction);
        }),
    } as any;

    return view;
}

const context: AppContext = Context.new({
    tracer: new TracerContextModule(testTracer),
    rpc: new TestRpcContextModule(),
    react: ReactContextModule.newForClient(),
    batch: BatchContextModule.new(),
    constants: new ConstantsContextModule({
        edgeServiceUrl: "https://test.cyberworlds.dev",
        resourceServiceUrl: "http://localhost",
    }),
});

function createSpellChecker(
    spaceId: SpaceId,
    view: EditorView,
    accessLevel: AccessLevel = "Manage",
) {
    return new ContentEditorSpellChecker({
        getContext: () => context,
        getAccessLevel: () => accessLevel,
        spaceId,
        view,
    });
}

// Loop until we see lints set. If they're never set, the given test will time out
// and fail.
async function waitForSpellCheckerLints(
    spellChecker: ContentEditorSpellChecker,
    options?: {
        fakeTimersEnabled?: boolean;
    },
) {
    if (options?.fakeTimersEnabled) {
        import.meta.jest.useRealTimers();
    }

    let attempts = 0;
    const maxAttempts = 250;

    while (attempts < maxAttempts && spellChecker.getSpellCheckCountForTest() === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
        attempts++;
    }

    if (options?.fakeTimersEnabled) {
        import.meta.jest.useFakeTimers();
    }
}

describe("ContentEditorSpellChecker", () => {
    let spaceId: SpaceId;
    let view: EditorView;

    beforeEach(() => {
        spaceId = generateId<SpaceId>();
        view = createMockEditorView();
    });

    afterEach(() => {
        import.meta.jest.clearAllTimers();
    });

    describe("constructor", () => {
        test("initializes and requests initial spell check", async () => {
            const spellChecker = createSpellChecker(spaceId, view);

            expect(spellChecker).toBeDefined();

            await waitForSpellCheckerLints(spellChecker);
        });
    });

    describe("destroy()", () => {
        test("sets destroyed flag", () => {
            const spellChecker = createSpellChecker(spaceId, view);

            spellChecker.destroy();

            const transaction = view.state.tr;

            expect(() => spellChecker.handleTransaction(transaction)).toThrow();
        });

        test("throws when called twice", () => {
            const spellChecker = createSpellChecker(spaceId, view);

            spellChecker.destroy();

            expect(() => spellChecker.destroy()).toThrow();
        });
    });

    describe("handleTransaction()", () => {
        beforeEach(() => {
            import.meta.jest.useFakeTimers();
        });

        afterEach(() => {
            import.meta.jest.useRealTimers();
        });

        test("ignores transactions without document changes", () => {
            const spellChecker = createSpellChecker(spaceId, view);
            const transaction = view.state.tr;
            Object.defineProperty(transaction, "docChanged", {value: false, writable: false});

            expect(() => spellChecker.handleTransaction(transaction)).not.toThrow();
        });

        describe("typing detection", () => {
            // eslint-disable-next-line cyberworlds/string-quotes
            const specialChars = "abcABC123@#$%^&*()-=[]\\;',/+{}|:\"<>";

            for (const char of specialChars) {
                test(`detects \u2018${char}\u2019 as typing`, () => {
                    const spellChecker = createSpellChecker(spaceId, view);
                    const transaction = view.state.tr.insertText(char, 1);

                    expect(() => spellChecker.handleTransaction(transaction)).not.toThrow();
                    expect(import.meta.jest.getTimerCount()).toBe(1);
                });
            }

            test("does not detect space as typing", () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.insertText(" ", 1);

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(0);
            });

            test("does not detect multi-character input as typing", () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.insertText("hello", 1);

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(0);
            });

            test("does not detect non-text nodes as typing", () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.replaceWith(1, 1, schema.node("break"));

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(0);
            });

            test("handles multiple steps in transaction", () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.insertText("a", 1).insertText("b", 2);

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(0);
            });
        });

        describe("debounce behavior", () => {
            beforeEach(() => {
                import.meta.jest.useFakeTimers();
            });

            afterEach(() => {
                import.meta.jest.useRealTimers();
            });

            test("debounces spell check when typing", async () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.insertText("a", 1);

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(1);

                import.meta.jest.advanceTimersByTime(searchWordTypingDebounceMs.desktop);
                expect(import.meta.jest.getTimerCount()).toBe(0);

                await waitForSpellCheckerLints(spellChecker, {
                    fakeTimersEnabled: true,
                });
            });

            test("clears previous timeout when typing", () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction1 = view.state.tr.insertText("a", 1);

                spellChecker.handleTransaction(transaction1);
                expect(import.meta.jest.getTimerCount()).toBe(1);

                import.meta.jest.advanceTimersByTime(searchWordTypingDebounceMs.desktop / 2);
                expect(import.meta.jest.getTimerCount()).toBe(1);

                // half way through the timeout, type again
                const transaction2 = view.state.tr.insertText("b", 2);
                spellChecker.handleTransaction(transaction2);
                expect(import.meta.jest.getTimerCount()).toBe(1);

                import.meta.jest.advanceTimersByTime(searchWordTypingDebounceMs.desktop / 2);
                expect(import.meta.jest.getTimerCount()).toBe(1);

                // after a full debounce time, our timeouts should be done
                import.meta.jest.advanceTimersByTime(searchWordTypingDebounceMs.desktop / 2);
                expect(import.meta.jest.getTimerCount()).toBe(0);
            });

            test("immediately triggers spell check for non-word typing", async () => {
                const spellChecker = createSpellChecker(spaceId, view);
                const transaction = view.state.tr.insertText(" ", 1);

                spellChecker.handleTransaction(transaction);

                expect(import.meta.jest.getTimerCount()).toBe(0);

                await waitForSpellCheckerLints(spellChecker, {fakeTimersEnabled: true});
            });
        });
    });

    test("skips spell check if destroyed during execution", async () => {
        const spellChecker = createSpellChecker(spaceId, view);
        const transaction = view.state.tr.insertText(" ", 1);

        spellChecker.handleTransaction(transaction);
        spellChecker.destroy();

        await waitForSpellCheckerLints(spellChecker);

        expect(view.dispatch).not.toHaveBeenCalled();
    });

    test("handles transaction with no steps", () => {
        const spellChecker = createSpellChecker(spaceId, view);
        const transaction = view.state.tr;

        expect(() => spellChecker.handleTransaction(transaction)).not.toThrow();
    });

    test("handles ReplaceStep with empty slice", () => {
        const spellChecker = createSpellChecker(spaceId, view);
        const transaction = view.state.tr.delete(1, 2);

        expect(() => spellChecker.handleTransaction(transaction)).not.toThrow();
    });

    test("handles concurrent spell checks with mutex", async () => {
        const spellChecker = createSpellChecker(spaceId, view);
        const transaction1 = view.state.tr.insertText(" ", 1);
        const transaction2 = view.state.tr.insertText(" ", 2);
        const transaction3 = view.state.tr.insertText(" ", 3);

        spellChecker.handleTransaction(transaction1);
        spellChecker.handleTransaction(transaction2);
        spellChecker.handleTransaction(transaction3);

        await waitForSpellCheckerLints(spellChecker);

        expect(view.dispatch).toHaveBeenCalled();
    });

    describe("access level behavior", () => {
        test("runs spell check when access level is Edit", async () => {
            const spellChecker = createSpellChecker(spaceId, view, "Edit");
            const transaction = view.state.tr.insertText(" ", 1);

            spellChecker.handleTransaction(transaction);

            await waitForSpellCheckerLints(spellChecker);

            expect(view.dispatch).toHaveBeenCalled();
            expect(spellChecker.getSpellCheckCountForTest()).toBeGreaterThanOrEqual(1);
        });

        test("runs spell check when access level is Manage", async () => {
            const spellChecker = createSpellChecker(spaceId, view, "Manage");
            const transaction = view.state.tr.insertText(" ", 1);

            spellChecker.handleTransaction(transaction);

            await waitForSpellCheckerLints(spellChecker);

            expect(view.dispatch).toHaveBeenCalled();
            expect(spellChecker.getSpellCheckCountForTest()).toBeGreaterThanOrEqual(1);
        });

        test("immediately clears lints when access level is View", () => {
            const spellChecker = createSpellChecker(spaceId, view, "View");
            const transaction = view.state.tr.insertText(" ", 1);

            spellChecker.handleTransaction(transaction);

            // Dispatch is called immediately to clear lints, but spell check doesn't run.
            expect(view.dispatch).toHaveBeenCalled();
            expect(spellChecker.getSpellCheckCountForTest()).toBe(0);
        });

        test("immediately clears lints when access level is Comment", () => {
            const spellChecker = createSpellChecker(spaceId, view, "Comment");
            const transaction = view.state.tr.insertText(" ", 1);

            spellChecker.handleTransaction(transaction);

            // Dispatch is called immediately to clear lints, but spell check doesn't run.
            expect(view.dispatch).toHaveBeenCalled();
            expect(spellChecker.getSpellCheckCountForTest()).toBe(0);
        });
    });
});
