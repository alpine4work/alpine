import {collab, getVersion, receiveTransaction, sendableSteps} from "prosemirror-collab";
import {history} from "prosemirror-history";
import {Node} from "prosemirror-model";
import {Command, EditorState, Plugin, PluginKey, Selection, Transaction} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {
    ContentEditorFloaterState,
    initialContentEditorFloaterState,
} from "~/client/content/internal/content_editor_floater";
import {
    buildInputRulesPlugin,
    openMentionFloaterMetaKey,
} from "~/client/content/internal/content_editor_plugin_input_rules";
import {
    buildKeymapPlugin,
    openCommentInputFloaterMetaKey,
    openKeyboardHighlightFloaterMetaKey,
    openKeyboardLinkFloaterMetaKey,
} from "~/client/content/internal/content_editor_plugin_keymap";
import {AccountModel} from "~/shared/accounts/account_model";
import {
    ContentReferences,
    ContentWithReferences,
    mergeContentReferences,
} from "~/shared/content/content_references";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {generateId, isId} from "~/shared/id/id";
import {ContentEditorClientId, DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";

export const createCommentThreadMetaKey = "createCommentThread";

function buildPlugins<Content extends ContentWithReferences>({
    schema,
    references,
    reduceReferences,
}: {
    schema: ContentProsemirrorSchema;
    references: Content["references"];
    reduceReferences: (
        references: Content["references"],
        action: ContentEditorReferencesAction<Content["references"]>,
    ) => Content["references"];
}) {
    return [
        history(),
        buildInputRulesPlugin(schema),
        buildKeymapPlugin(schema),
        contentEditorFloaterStatePlugin(),
        contentEditorReferencesPlugin(references, reduceReferences),
        contentEditorQuickUndoPlugin(),
    ];
}

/**
 * Represents the entire state of our `<ContentEditor>` component.
 *
 * We have a wrapper to require the user of certain plugins.
 *
 * Wraps around ProseMirror's own `EditorState` and provides a controlled
 * interface to the outside world.
 */
export class ContentEditorState<Content extends ContentWithReferences> {
    /**
     * Creates a new state for our content editor.
     *
     * Simplified editor state creation for content with a normal
     * `ContentReferences` object. You need to use `_create()` or
     * `createCollaborative()` to customize the `ContentReferences` type.
     */
    public static create<ContentDoc extends Node>(
        content: ContentWithReferences & {doc: ContentDoc},
        options: {
            selectionAt?: "start" | "end";
        } = {},
    ): ContentEditorState<ContentWithReferences & {doc: ContentDoc}> {
        return ContentEditorState._create({
            ...options,
            content,
            reduceReferences: reduceContentReferences,
        });
    }

    /**
     * Creates a new state for our content editor allowing the user to customize
     * the type of `ContentReferences`.
     */
    private static _create<Content extends ContentWithReferences>({
        content,
        reduceReferences,
        selectionAt = "start",
    }: {
        /** The initial content of the editor. */
        content: Content;

        /**
         * The editor may dispatch actions to update the content's references. This
         * function implements the reducer for those actions. If the type of your
         * references is `ContentReferences` you may use the provided
         * `reduceContentReferences()` function. If you are not using
         * `ContentReferences` (e.g. you're using `DocumentContentReferences`) then you
         * need to implement this function yourself.
         */
        reduceReferences: (
            references: Content["references"],
            action: ContentEditorReferencesAction<Content["references"]>,
        ) => Content["references"];

        /**
         * Where should we put our selection when the user first focuses the
         * content editor?
         */
        selectionAt?: "start" | "end";
    }): ContentEditorState<Content> {
        const schema = content.doc.type.schema;
        assert(schema.topNodeType === content.doc.type);

        const plugins = buildPlugins({
            schema,
            references: content.references,
            reduceReferences,
        });

        return new ContentEditorState(
            EditorState.create({
                doc: content.doc,
                plugins,
                selection:
                    selectionAt === "end"
                        ? Selection.atEnd(content.doc)
                        : Selection.atStart(content.doc),
            }),
        );
    }

    /**
     * Creates a new collaborative state for our content editor.
     */
    public static createCollaborative<Content extends ContentWithReferences>({
        version,
        content,
        reduceReferences,
    }: {
        /**
         * The content version for collaborative editing.
         */
        version: number;

        /**
         * The initial content in the editor. If no content is provided then we
         * start with empty content.
         */
        content: Content;

        /**
         * The editor may dispatch actions to update the content's references. This
         * function implements the reducer for those actions. If the type of your
         * references is `ContentReferences` you may use the provided
         * `reduceContentReferences()` function. If you are not using
         * `ContentReferences` (e.g. you're using `DocumentContentReferences`) then you
         * need to implement this function yourself.
         */
        reduceReferences: (
            references: Content["references"],
            action: ContentEditorReferencesAction<Content["references"]>,
        ) => Content["references"];
    }): ContentEditorState<Content> {
        const schema = content.doc.type.schema;

        assert(schema.topNodeType === content.doc.type);

        const plugins = [
            ...buildPlugins({
                schema,
                references: content.references,
                reduceReferences,
            }),
            collab({
                // Every client gets its own ID generated by the client. If a bad actor
                // client impersonates another, known, client they can cause some annoying bugs
                // but that's about it.
                //
                // The ID is necessary so the client knows when it is confirming steps it
                // generated vs. receiving steps from another client. We generate an ID for
                // every content state instance because if you have two content editors on the
                // page they need separate IDs so they don't conflict.
                clientID: generateId(),
                version,
            }),
        ];

        const state = new ContentEditorState<Content>(
            EditorState.create({
                doc: content.doc,
                plugins,
            }),
        );

        assert(state.isCollaborative());
        return state;
    }

    private readonly _state: EditorState;

    private constructor(state: EditorState) {
        this._state = state;
    }

    /**
     * The current content rendered in the editor.
     *
     * Our state contains more information than just the content. For instance,
     * the cursor position.
     */
    public getContent(): Content {
        return getContentEditorReferences(this._state) as Content;
    }

    public getDoc(): Content["doc"] {
        return this._state.doc as Content["doc"];
    }

    /**
     * Get the current selection.
     */
    public getSelection(): Selection {
        return this._state.selection;
    }

    /**
     * Get the current floater state.
     */
    public getFloaterState(): ContentEditorFloaterState {
        return getContentEditorFloaterState(this._state);
    }

    /**
     * Is this content editor state collaborative?
     */
    public isCollaborative(): boolean {
        return isCollabPlugin(this._state.plugins[this._state.plugins.length - 1]!);
    }

    /**
     * Gets the ID we generated for this client when it was created.
     */
    public getClientId(): ContentEditorClientId {
        const collabPlugin = this._state.plugins[this._state.plugins.length - 1]!;
        assert(isCollabPlugin(collabPlugin));
        return collabPlugin.spec.config.clientID;
    }

    /**
     * Get the current version of our content for collaborative editing.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public getVersion(): number {
        assert(this.isCollaborative());
        return getVersion(this._state);
    }

    /**
     * Are there any unconfirmed local steps the server hasn't acknowledged?
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public hasSendableSteps(): boolean {
        assert(this.isCollaborative());
        assert(collabPluginKey);
        return collabPluginKey.getState(this._state).unconfirmed.length > 0;
    }

    /**
     * Provides the unconfirmed steps for this content that we need to send to
     * a central authority.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public sendableSteps(): {
        version: number;
        steps: ReadonlyArray<Step>;
        origins: ReadonlyArray<Transaction>;
        clientId: ContentEditorClientId;
    } | null {
        assert(this.isCollaborative());

        const result = sendableSteps(this._state);
        if (!result) return null;

        assert(typeof result.clientID === "string" && isId(result.clientID));

        return {
            version: result.version,
            steps: result.steps,
            origins: result.origins,
            clientId: result.clientID as ContentEditorClientId,
        };
    }

    /**
     * Receive steps that originated from a `sendableSteps()` call.
     *
     * We also expect new `ContentReferences` associated with the new steps.
     *
     * May only call this method if the content editor state is collaborative.
     * (Can check with `isCollab()`.)
     */
    public receiveSteps(
        steps: Iterable<{step: Step; clientId: ContentEditorClientId}>,
        // We require you to pass in content references because if you have user
        // generated steps then there may also be references associated with those
        // steps you need to provide.
        stepsContentReferences: Content["references"],
    ): ContentEditorState<Content> {
        let state: ContentEditorState<Content> = this;
        let stepTransaction: Array<{step: Step; clientId: ContentEditorClientId}> = [];

        // `prosemirror-collab` needs steps from our `clientId` to be at the beginning
        // of the `receiveSteps()` call. So call `receiveSteps()` whenever the
        // `clientId` of our steps change.
        //
        // Arguably, this is a bug in `prosemirror-collab`.
        //
        // Here is the code which requires our steps to be first this:
        // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L125-L129
        for (const {step, clientId} of steps) {
            if (
                stepTransaction.length > 0 &&
                stepTransaction[stepTransaction.length - 1]!.clientId !== clientId
            ) {
                state = state._receiveSteps(stepTransaction, null);
                stepTransaction = [];
            }

            stepTransaction.push({step, clientId});
        }

        state = state._receiveSteps(stepTransaction, stepsContentReferences);
        stepTransaction = [];

        return state;
    }

    private _receiveSteps(
        steps: Iterable<{step: Step; clientId: ContentEditorClientId}>,
        stepsContentReferences: Content["references"] | null,
    ): ContentEditorState<Content> {
        assert(this.isCollaborative());

        const stepsWithoutClientId = [];
        const clientIds = [];

        for (const {step, clientId} of steps) {
            stepsWithoutClientId.push(step);
            clientIds.push(clientId);
        }

        // Validation in development that if we're receiving steps from our client we
        // do have steps we're waiting to receive. Otherwise ProseMirror ignores the
        // steps and we can get into a bad state.
        if (
            process.env.NODE_ENV !== "production" &&
            clientIds.includes(this.getClientId()) &&
            !this.hasSendableSteps()
        ) {
            throw new InternalError(
                "Receiving confirmed steps for our client but our client has no unconfirmed steps",
            );
        }

        const transaction = receiveTransaction(this._state, stepsWithoutClientId, clientIds, {
            // Users usually prefer this, but it isn't done by default for reasons
            // of backwards compatibility.
            mapSelectionBackward: true,
        });

        if (stepsContentReferences !== null) {
            updateContentEditorReferences(transaction, {
                type: "Merge",
                references: stepsContentReferences,
            });
        }

        return new ContentEditorState(this._state.apply(transaction));
    }

    private _docWithoutSendableSteps: Content["doc"] | null = null;

    /**
     * Get the underlying content as if there are no unconfirmed steps.
     *
     * This is the content as the server currently sees it.
     */
    public getDocWithoutSendableSteps(): Content["doc"] {
        assert(this.isCollaborative());

        if (!this._docWithoutSendableSteps) {
            assert(collabPluginKey);
            const {unconfirmed} = collabPluginKey.getState(this._state);

            let doc = this._state.doc;

            for (let i = unconfirmed.length - 1; i >= 0; i--) {
                const invertedStep: Step = unconfirmed[i].inverted;
                const stepResult = invertedStep.apply(doc);
                assert(stepResult.doc);
                doc = stepResult.doc;
            }

            this._docWithoutSendableSteps = doc as Content["doc"];
        }

        return this._docWithoutSendableSteps;
    }

    /**
     * Update the references in our state with an action.
     */
    public updateReferences(
        action: ContentEditorReferencesAction<Content["references"]>,
    ): ContentEditorState<Content> {
        return new ContentEditorState(
            this._state.apply(updateContentEditorReferences(this._state.tr, action)),
        );
    }
}

let collabPluginKey: PluginKey;

/**
 * Is the provided plugin a `prosemirror-collab` plugin?
 */
function isCollabPlugin(plugin: Plugin) {
    if (collabPluginKey === undefined) {
        const {key} = collab().spec;
        assert(key);
        collabPluginKey = key;
    }
    return plugin.spec.key === collabPluginKey;
}

const contentEditorFloaterStatePluginKey = new PluginKey<ContentEditorFloaterState>(
    "contentEditorFloaterState",
);

function contentEditorFloaterStatePlugin() {
    return new Plugin<ContentEditorFloaterState>({
        key: contentEditorFloaterStatePluginKey,
        state: {
            init: () => initialContentEditorFloaterState,
            apply: (transaction, floaterState, oldState, newState) => {
                const transactionFloaterState: ContentEditorFloaterState | undefined =
                    transaction.getMeta(contentEditorFloaterStatePluginKey);
                if (transactionFloaterState) return transactionFloaterState;

                // Open our toolbars on the current selection when certain meta is set on
                // our transaction.
                if (transaction.getMeta(openKeyboardHighlightFloaterMetaKey)) {
                    return {
                        type: "KeyboardHighlight",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }
                if (transaction.getMeta(openKeyboardLinkFloaterMetaKey)) {
                    return {
                        type: "KeyboardLink",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }
                if (transaction.getMeta(openCommentInputFloaterMetaKey)) {
                    return {
                        type: "CommentInput",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }

                // Double check that we can only open the `Mention` floater if the character
                // preceding our selection is `@`.
                if (transaction.getMeta(openMentionFloaterMetaKey) && newState.selection.head > 0) {
                    const $from = newState.doc.resolve(newState.selection.head - 1);
                    if (
                        $from.parent.textBetween($from.parentOffset, $from.parentOffset + 1) === "@"
                    ) {
                        return {
                            type: "Mention",
                            range: {from: $from.pos, to: newState.selection.head},
                            searchQuery: "",
                            handleKeyDownRef: {current: null},
                            isClosing: false,
                        };
                    }
                }

                // `PointerToolbar` is the only state which does not record its position.
                if (floaterState.type === "PointerToolbar") return floaterState;

                const newRangeFrom = transaction.mapping.map(floaterState.range.from);
                const newRangeTo = transaction.mapping.map(floaterState.range.to);

                // If the range collapsed into a single position (maybe the content was
                // deleted?) reset to the initial state.
                if (newRangeFrom === newRangeTo) {
                    floaterState = initialContentEditorFloaterState;
                } else if (
                    floaterState.range.from !== newRangeFrom ||
                    floaterState.range.to !== newRangeTo
                ) {
                    floaterState = {
                        ...floaterState,
                        range: {from: newRangeFrom, to: newRangeTo},
                    };
                }

                // Adjust our mention range based on the selection's new position.
                if (floaterState.type === "Mention" && !floaterState.isClosing) {
                    const $from = newState.doc.resolve(floaterState.range.from);

                    // If the mention no longer starts with `@` then close our floater.
                    if (
                        $from.parent.textBetween($from.parentOffset, $from.parentOffset + 1) !== "@"
                    ) {
                        floaterState = {...floaterState, isClosing: true};
                    }
                    // If the head of our selection left the beginning of our mention range then
                    // reset our floater back to the initial state.
                    else if (newState.selection.head < floaterState.range.from) {
                        floaterState = {...floaterState, isClosing: true};
                    }
                    // If the head of our selection left the end of our mention range...
                    else if (newState.selection.head > floaterState.range.to) {
                        // We want to extend the mention range if the user is typing within the mention
                        // and extending the search query. We want to cancel the mention range if the
                        // user is explicitly moving their selection outside of the mention range.
                        //
                        // We use the heuristic that if both the document changed and the selection was
                        // explicitly set in our transaction that indicates the user is typing (or
                        // pasting or similar). This isn't perfect. Ideally we'd also check that this
                        // came from our client (and not a collaborative edit) or that the document
                        // change happened inside our mention range.
                        //
                        // If the user pasted multiple paragraphs of content then our floater state
                        // will be cleaned up below.
                        if (!transaction.selectionSet || !transaction.docChanged) {
                            floaterState = {...floaterState, isClosing: true};
                        } else {
                            floaterState = {
                                ...floaterState,
                                range: {from: floaterState.range.from, to: newState.selection.head},
                            };
                        }
                    }
                }

                // Compute the new search query for our mention floater and put it in our
                // state. If the mention range does not have a valid search query then we will
                // reset our floater state here.
                if (floaterState.type === "Mention" && !floaterState.isClosing) {
                    const mentionSlice = newState.doc.slice(
                        floaterState.range.from + 1,
                        floaterState.range.to,
                    );
                    if (
                        mentionSlice.openStart !== 0 ||
                        mentionSlice.openEnd !== 0 ||
                        mentionSlice.content.childCount > 1
                    ) {
                        floaterState = {...floaterState, isClosing: true};
                    } else {
                        const child = mentionSlice.content.firstChild;
                        if (child && child.type.name !== "text") {
                            floaterState = {...floaterState, isClosing: true};
                        } else {
                            const searchQuery = child?.text ?? "";

                            if (searchQuery.includes("@")) {
                                floaterState = {...floaterState, isClosing: true};
                            } else if (searchQuery !== floaterState.searchQuery) {
                                floaterState = {
                                    ...floaterState,
                                    searchQuery,
                                };
                            }
                        }
                    }
                }

                return floaterState;
            },
        },
    });
}

export function getContentEditorFloaterState(state: EditorState): ContentEditorFloaterState {
    return assertExists(contentEditorFloaterStatePluginKey.getState(state));
}

export function setContentEditorFloaterState(
    transaction: Transaction,
    floaterState: ContentEditorFloaterState,
): Transaction {
    return transaction.setMeta(contentEditorFloaterStatePluginKey, floaterState);
}

const contentEditorReferencesPluginKey = new PluginKey<{
    doc: Node;
    references: ContentReferences;
}>("contentEditorReferences");

// We store content references in a plugin on our `ContentEditorState` so that
// it is updated in lockstep with the underlying doc.
function contentEditorReferencesPlugin<References extends ContentReferences>(
    initialReferences: References,
    reduceReferences: (
        references: References,
        action: ContentEditorReferencesAction<References>,
    ) => References,
) {
    return new Plugin<{
        doc: Node;
        references: References;
    }>({
        key: contentEditorReferencesPluginKey,
        state: {
            init: (config, state) => ({doc: state.doc, references: initialReferences}),
            apply: (transaction, oldPluginState, oldState, newState) => {
                const action: ContentEditorReferencesAction<References> | undefined =
                    transaction.getMeta(contentEditorReferencesPluginKey);

                const newReferences = action
                    ? reduceReferences(oldPluginState.references, action)
                    : oldPluginState.references;

                if (newReferences === oldPluginState.references && !transaction.docChanged)
                    return oldPluginState;

                // We maintain a `ContentWithReferences` object in our plugin (instead of just
                // `ContentReferences`) so that the we can have a memoized object reference
                // that won't break any `useMemo()`s that listen to it on spurious changes.
                return {
                    doc: newState.doc,
                    references: newReferences,
                };
            },
        },
    });
}

export function getContentEditorReferences(state: EditorState): ContentWithReferences {
    return assertExists(contentEditorReferencesPluginKey.getState(state));
}

export function updateContentEditorReferences<References extends ContentReferences>(
    transaction: Transaction,
    action: ContentEditorReferencesAction<References>,
): Transaction {
    return transaction.setMeta(contentEditorReferencesPluginKey, action);
}

export type ContentEditorReferencesAction<References extends ContentReferences> =
    | ContentEditorReferencesMergeAction<References>
    | ContentEditorReferencesAddAccountAction
    | ContentEditorReferencesUpdateDocumentCommentThreadAction;

export type ContentEditorReferencesMergeAction<References extends ContentReferences> = {
    readonly type: "Merge";
    readonly references: References;
};

export type ContentEditorReferencesAddAccountAction = {
    readonly type: "AddAccount";
    readonly account: AccountModel;
};

/**
 * This action is designed to be idempotent and runnable out-of-order. You can
 * run it as often as you'd like. You can run it optimistically and then run it
 * again after you get a response back from the server. References will
 * converge to the correct value.
 */
export type ContentEditorReferencesUpdateDocumentCommentThreadAction = {
    readonly type: "UpdateDocumentCommentThread";
    readonly commentThreadId: DocumentCommentThreadId;
    readonly commentCount: number;
    readonly addCommentAuthor: AccountModel | null;
};

export function reduceContentReferences(
    references: ContentReferences,
    action: ContentEditorReferencesAction<ContentReferences>,
): ContentReferences {
    switch (action.type) {
        case "Merge":
            return mergeContentReferences(references, action.references);
        case "AddAccount": {
            return {
                ...references,
                accountById: new Map([
                    ...references.accountById,
                    [action.account.id, action.account],
                ]),
            };
        }
        // These actions are only used with `DocumentContentReferences`.
        case "UpdateDocumentCommentThread":
            return references;
        default:
            throw exhaustive(action);
    }
}

const contentEditorQuickUndoPluginKey = new PluginKey<Transaction | null>("contentEditorQuickUndo");

function contentEditorQuickUndoPlugin() {
    return new Plugin<Transaction | null>({
        key: contentEditorQuickUndoPluginKey,
        state: {
            init: () => null,
            apply: (transaction, quickUndoTransaction) => {
                const newQuickUndoTransaction = transaction.getMeta(
                    contentEditorQuickUndoPluginKey,
                );
                if (newQuickUndoTransaction) return newQuickUndoTransaction;

                // If the selection moved or document changed then throw away our quick undo.
                // It might not work anymore on the new document.
                return transaction.selectionSet || transaction.docChanged
                    ? null
                    : quickUndoTransaction;
            },
        },
    });
}

/**
 * Set a quick undo transaction in our state. Next time the user presses cmd-z
 * (before changing the document) the quick undo transaction will run. The quick
 * undo transaction must be executable on the document produced by the current
 * transaction.
 */
export function setContentEditorQuickUndo(
    transaction: Transaction,
    quickUndoTransaction: Transaction,
): Transaction {
    return transaction.setMeta(contentEditorQuickUndoPluginKey, quickUndoTransaction);
}

/**
 * If there is a quick undo entry then execute it.
 */
export const contentEditorQuickUndoCommand: Command = (state, dispatch) => {
    const quickUndoTransaction = contentEditorQuickUndoPluginKey.getState(state);
    if (quickUndoTransaction) {
        dispatch?.(quickUndoTransaction);
        return true;
    }

    return false;
};
