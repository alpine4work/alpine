import {collab, getVersion, receiveTransaction, sendableSteps} from "prosemirror-collab";
import {history, redoDepth, undoDepth} from "prosemirror-history";
import {Node} from "prosemirror-model";
import {
    Command,
    EditorState,
    Plugin,
    PluginKey,
    Selection,
    SelectionBookmark,
    Transaction,
} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {ContentEditorFloaterState} from "~/client/web/content/state/content_editor_floater_state.js";
import {
    openContentEditorCommentInputFloaterMetaKey,
    openContentEditorKeyboardHighlightFloaterMetaKey,
    openContentEditorKeyboardLinkFloaterMetaKey,
    openContentEditorMentionFloaterMetaKey,
} from "~/client/web/content/state/content_editor_meta_keys.js";
import {contentEditorSpellCheckerPlugin} from "~/client/web/content/state/content_editor_spell_checker_plugin.js";
import {contentEditorCodeBlockPlugin} from "~/client/web/content/state/internal/content_editor_code_block_plugin.js";
import {buildContentEditorInputRulesPlugin} from "~/client/web/content/state/internal/content_editor_input_rules_plugin.js";
import {buildContentEditorKeymapPlugin} from "~/client/web/content/state/internal/content_editor_keymap_plugin.js";
import {sharedContentEditorTrackSelectionWithinPlugin} from "~/client/web/content/state/shared/shared_content_editor_track_selection_within_plugin.js";
import {contentEditorTablePlugin} from "~/client/web/content/state/table/content_editor_table_plugin.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {
    ContentReferences,
    ContentReferencesSearchEntity,
    ContentWithReferences,
    mergeContentReferences,
    mergeContentReferencesFileSignedUrlSearches,
} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {undoMergeTextUpdatesDelayMs} from "~/shared/design/core/timing.js";
import {InternalError} from "~/shared/error/error.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {Id, generateId, isId} from "~/shared/id/id.js";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {hasSpellCheckFeature} from "~/shared/spaces/has_spell_check_feature.js";

export const createContentCommentThreadMetaKey = "createCommentThread";
export const intentionallyUpdateContentAccessPolicyMetaKey = "intentionallyUpdateAccessPolicy";

function buildPlugins<Content extends ContentWithReferences>({
    schema,
    references,
    reduceReferences,
    disableUndoKeyboardShortcuts,
}: {
    schema: ContentProsemirrorSchema;
    references: Content["references"];
    reduceReferences: (
        references: Content["references"],
        action: ContentEditorReferencesAction<Content["references"]>,
    ) => Content["references"];
    disableUndoKeyboardShortcuts: boolean;
}) {
    const plugins = [
        history({
            newGroupDelay: undoMergeTextUpdatesDelayMs,
            // If we're disabling undo/redo keyboard shortcuts it means our rendering component
            // is managing undo/redo stacks. In that case our history plugin should never clear
            // out old events which would make our history plugin out-of-sync with our
            // rendering component.
            depth: disableUndoKeyboardShortcuts ? Number.MAX_SAFE_INTEGER : undefined,
        }),
        buildContentEditorInputRulesPlugin(schema),
        buildContentEditorKeymapPlugin(schema, {disableUndoKeyboardShortcuts}),
        contentEditorFloaterStatePlugin(),
        contentEditorReferencesPlugin(references, reduceReferences),
        contentEditorQuickUndoPlugin(),
        contentEditorRetypedInputRulePlugin(),
        contentEditorIsContinuouslyTypingPlugin(),
        contentEditorSelectionGeneration(),
        contentEditorRememberPosWhileLoadingPlugin(),
        contentEditorCodeBlockPlugin(),
        contentEditorTablePlugin(),
        sharedContentEditorTrackSelectionWithinPlugin(),
    ];

    // A bit of a hack to get the spaceId while this plugin is feature flagged We don't
    // run harper server side, so we won't show errors outside the browser anyways
    const spaceId =
        typeof window !== "undefined"
            ? (window.location.pathname.match(/\/s\/([^/]+)/)?.[1] as SpaceId) || null
            : null;

    // Native spellcheck is often more distracting then it's worth. It puts a red
    // squiggly under names, nouns, industry terms, and oddly sometimes contractions
    // (like "they're", maybe has to do with curly quotes?).
    //
    // It's also inconsistent with `<input>`s which don't have spellcheck on by
    // default.
    //
    // In iOS, however, the native spellchecker is _essential_ for proper document
    // editing. Since typos abound on mobile keyboards. Unlike on web, iOS spell check
    // results show up inline instead of requiring a right click (which we override).
    //
    // Make sure our spell checker is disabled on mobile, the native spell checker
    // should win there.
    if (
        spaceId &&
        hasSpellCheckFeature(spaceId) &&
        !isMobileWebKit &&
        // Create an escape hatch while we're testing in case things break
        localStorage.getItem("disableSpellCheck") !== "true"
    ) {
        plugins.push(contentEditorSpellCheckerPlugin());
    }

    return plugins;
}

/**
 * Represents the entire state of our `<ContentEditor>` component.
 *
 * We have a wrapper to require the user of certain plugins.
 *
 * Wraps around ProseMirror's own `EditorState` and provides a controlled interface
 * to the outside world.
 */
export class ContentEditorState<Content extends ContentWithReferences> {
    /**
     * Creates a new state for our content editor.
     *
     * Simplified editor state creation for content with a normal `ContentReferences`
     * object. You need to use `_create()` or `createCollaborative()` to customize the
     * `ContentReferences` type.
     */
    public static create<ContentDoc extends Node>(
        content: ContentWithReferences & {doc: ContentDoc},
        options: {
            /**
             * The initial selection to use for the editor state. If the string "start" or
             * "end" then we'll automatically put the selection at that side of the doc.
             */
            selection?: "start" | "end" | Selection | SelectionBookmark;

            /**
             * Should the undo/redo keyboard shortcuts be disabled on this editor? When this is
             * set to true it usually means the component rendering our content editor will
             * managed undo/redo keyboard shortcuts.
             */
            disableUndoKeyboardShortcuts?: boolean;
        } = {},
    ): ContentEditorState<ContentWithReferences & {doc: ContentDoc}> {
        return ContentEditorState._create({
            ...options,
            content,
            reduceReferences: reduceContentReferences,
        });
    }

    /**
     * Creates a new state for our content editor allowing the user to customize the
     * type of `ContentReferences`.
     */
    private static _create<Content extends ContentWithReferences>({
        content,
        reduceReferences,
        selection = "start",
        disableUndoKeyboardShortcuts = false,
    }: {
        /** The initial content of the editor. */
        content: Content;

        /**
         * The editor may dispatch actions to update the content's references. This
         * function implements the reducer for those actions. If the type of your
         * references is `ContentReferences` you may use the provided
         * `reduceContentReferences()` function. If you are not using `ContentReferences`
         * (e.g. you're using `DocumentContentReferences`) then you need to implement this
         * function yourself.
         */
        reduceReferences: (
            references: Content["references"],
            action: ContentEditorReferencesAction<Content["references"]>,
        ) => Content["references"];

        selection?: "start" | "end" | Selection | SelectionBookmark;
        disableUndoKeyboardShortcuts?: boolean;
    }): ContentEditorState<Content> {
        const schema = content.doc.type.schema;
        assert(schema.topNodeType === content.doc.type);

        const plugins = buildPlugins({
            schema,
            references: content.references,
            reduceReferences,
            disableUndoKeyboardShortcuts,
        });

        return new ContentEditorState(
            EditorState.create({
                doc: content.doc,
                plugins,
                selection:
                    selection === "start"
                        ? Selection.atStart(content.doc)
                        : selection === "end"
                          ? Selection.atEnd(content.doc)
                          : selection instanceof Selection
                            ? selection
                            : selection.resolve(content.doc),
            }),
        );
    }

    /**
     * Creates a new collaborative state for our content editor.
     */
    public static createCollaborative<Content extends ContentWithReferences>({
        version,
        content,
        selection = "start",
        reduceReferences,
        clientId = generateId<ContentEditorClientId>(),
        disableUndoKeyboardShortcuts = false,
    }: {
        /**
         * The content version for collaborative editing.
         */
        version: number;

        /**
         * The initial content in the editor. If no content is provided then we start with
         * empty content.
         */
        content: Content;

        /**
         * The initial selection to use for the editor state. If the string "start" or
         * "end" then we'll automatically put the selection at that side of the doc.
         */
        selection?: "start" | "end" | Selection | SelectionBookmark;

        /**
         * The editor may dispatch actions to update the content's references. This
         * function implements the reducer for those actions. If the type of your
         * references is `ContentReferences` you may use the provided
         * `reduceContentReferences()` function. If you are not using `ContentReferences`
         * (e.g. you're using `DocumentContentReferences`) then you need to implement this
         * function yourself.
         */
        reduceReferences: (
            references: Content["references"],
            action: ContentEditorReferencesAction<Content["references"]>,
        ) => Content["references"];

        /**
         * Identifier for this content editor. Each client should have its own unique ID to
         * figure out which edits were made by us vs others.
         */
        clientId?: ContentEditorClientId;

        /**
         * Should the undo/redo keyboard shortcuts be disabled on this editor? When this is
         * set to true it usually means the component rendering our content editor will
         * managed undo/redo keyboard shortcuts.
         */
        disableUndoKeyboardShortcuts?: boolean;
    }): ContentEditorState<Content> {
        const schema = content.doc.type.schema;

        assert(schema.topNodeType === content.doc.type);

        const plugins = [
            ...buildPlugins({
                schema,
                references: content.references,
                reduceReferences,
                disableUndoKeyboardShortcuts,
            }),
            collab({
                // Every client gets its own ID generated by the client. If a bad actor client
                // impersonates another, known, client they can cause some annoying bugs but that's
                // about it.
                //
                // The ID is necessary so the client knows when it is confirming steps it generated
                // vs. receiving steps from another client. We generate an ID for every content
                // state instance because if you have two content editors on the page they need
                // separate IDs so they don't conflict.
                clientID: clientId,
                version,
            }),
        ];

        const state = new ContentEditorState<Content>(
            EditorState.create({
                doc: content.doc,
                plugins,
                selection:
                    selection === "start"
                        ? Selection.atStart(content.doc)
                        : selection === "end"
                          ? Selection.atEnd(content.doc)
                          : selection instanceof Selection
                            ? selection
                            : selection.resolve(content.doc),
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
     * Get the internal ProseMirror editor state object. Prefer the public methods on
     * this class that provide a constrained, safe, interface. But this escape hatch is
     * available if necessary.
     */
    public _getInternalState(): EditorState & {schema: ContentProsemirrorSchema} {
        return this._state as EditorState & {schema: ContentProsemirrorSchema};
    }

    /**
     * The current content rendered in the editor.
     *
     * Our state contains more information than just the content. For instance, the
     * cursor position.
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
     * May only call this method if the content editor state is collaborative. (Can
     * check with `isCollab()`.)
     */
    public getVersion(): number {
        assert(this.isCollaborative());
        return getVersion(this._state);
    }

    /**
     * Are there any unconfirmed local steps the server hasn't acknowledged?
     *
     * May only call this method if the content editor state is collaborative. (Can
     * check with `isCollab()`.)
     */
    public hasSendableSteps(): boolean {
        assert(this.isCollaborative());
        assert(collabPluginKey);
        return collabPluginKey.getState(this._state).unconfirmed.length > 0;
    }

    /**
     * Provides the unconfirmed steps for this content that we need to send to a
     * central authority.
     *
     * May only call this method if the content editor state is collaborative. (Can
     * check with `isCollab()`.)
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
     * May only call this method if the content editor state is collaborative. (Can
     * check with `isCollab()`.)
     */
    public receiveSteps(
        steps: Iterable<{step: Step; clientId: ContentEditorClientId}>,
        // We require you to pass in content references because if you have user generated
        // steps then there may also be references associated with those steps you need to
        // provide.
        stepsContentReferences: Content["references"],
    ): ContentEditorState<Content> {
        let state: ContentEditorState<Content> = this;
        let stepTransaction: Array<{step: Step; clientId: ContentEditorClientId}> = [];

        // `prosemirror-collab` needs steps from our `clientId` to be at the beginning of
        // the `receiveSteps()` call. So call `receiveSteps()` whenever the `clientId` of
        // our steps change.
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

        // Validation in development that if we're receiving steps from our client we do
        // have steps we're waiting to receive. Otherwise ProseMirror ignores the steps and
        // we can get into a bad state.
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
            // Users usually prefer this, but it isn't done by default for reasons of backwards
            // compatibility.
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
     * Deletes all data within a range in the content editor.
     */
    public delete(from?: number, to?: number): [ContentEditorState<Content>, Transaction] {
        const transaction = this._state.tr.delete(from ?? 0, to ?? this._state.doc.content.size);
        return [new ContentEditorState(this._state.apply(transaction)), transaction];
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

    /**
     * Set the access policy for this content.
     *
     * Throws an error if the content doesn't have an access policy. Makes sure the
     * `intentionallyUpdateAccessPolicy` option is set when running this update on the
     * backend.
     */
    public setAccessPolicy(
        accessPolicy: AccessPolicy,
        notification: ShareNotification | null,
    ): ContentEditorState<Content> {
        assert(this._state.schema.topNodeType.spec.attrs?.accessPolicy);

        return new ContentEditorState(
            this._state.apply(
                this._state.tr
                    .setDocAttribute("accessPolicy", accessPolicy)
                    .setMeta(intentionallyUpdateContentAccessPolicyMetaKey, {
                        accessPolicy,
                        notification,
                    })
                    // Don't allow undoing access policy changes with cmd-z. Trying to undo an access
                    // policy change will cause an error since it doesn't have the
                    // `intentionallyUpdateAccessPolicy` property set.
                    .setMeta("addToHistory", false),
            ),
        );
    }

    /**
     * The amount of undoable events available.
     */
    public undoDepth() {
        return undoDepth(this._state);
    }

    /**
     * The amount of redoable events available.
     */
    public redoDepth() {
        return redoDepth(this._state);
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
            init: () => ({type: "PointerToolbar", previousState: null}),
            apply: (transaction, floaterState, oldState, newState) => {
                const transactionFloaterState: ContentEditorFloaterState | undefined =
                    transaction.getMeta(contentEditorFloaterStatePluginKey);
                if (transactionFloaterState) return transactionFloaterState;

                // Open our toolbars on the current selection when certain meta is set on our
                // transaction.
                if (transaction.getMeta(openContentEditorKeyboardHighlightFloaterMetaKey)) {
                    return {
                        type: "KeyboardHighlight",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }
                if (transaction.getMeta(openContentEditorKeyboardLinkFloaterMetaKey)) {
                    return {
                        type: "KeyboardLink",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }
                if (transaction.getMeta(openContentEditorCommentInputFloaterMetaKey)) {
                    return {
                        type: "CommentInput",
                        range: trimSpacesFromProsemirrorRange(newState.doc, newState.selection),
                    };
                }

                // Double check that we can only open the `Mention` floater if the character
                // preceding our selection is the trigger character (`@` or `/`).
                const mentionTriggerCharacter: "@" | "/" | undefined = transaction.getMeta(
                    openContentEditorMentionFloaterMetaKey,
                );
                if (mentionTriggerCharacter && newState.selection.head > 0) {
                    const $from = newState.doc.resolve(newState.selection.head - 1);
                    if (
                        $from.parent.textBetween($from.parentOffset, $from.parentOffset + 1) ===
                        mentionTriggerCharacter
                    ) {
                        return {
                            type: "Mention",
                            triggerCharacter: mentionTriggerCharacter,
                            range: {from: $from.pos, to: newState.selection.head},
                            searchQuery: "",
                            handleKeyDownRef: {current: null},
                            handleKeyUpRef: {current: null},
                            isClosing: false,
                        };
                    }
                }

                // `PointerToolbar` and `GifPicker` do not record a position in the document.
                if (floaterState.type === "PointerToolbar" || floaterState.type === "GifPicker") {
                    return floaterState;
                }

                const newRangeFrom = transaction.mapping.map(floaterState.range.from);
                const newRangeTo = transaction.mapping.map(floaterState.range.to);

                // If the range collapsed into a single position (maybe the content was deleted?)
                // reset to the initial state.
                if (newRangeFrom === newRangeTo) {
                    floaterState = {type: "PointerToolbar", previousState: floaterState};
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

                    // If the mention no longer starts with the trigger character then close our
                    // floater.
                    if (
                        !$from.parent.inlineContent ||
                        $from.parentOffset === $from.parent.content.size ||
                        $from.parent.textBetween($from.parentOffset, $from.parentOffset + 1) !==
                            floaterState.triggerCharacter
                    ) {
                        floaterState = {...floaterState, isClosing: true};
                    }
                    // If the head of our selection left the beginning of our mention range then reset
                    // our floater back to the initial state.
                    else if (newState.selection.head < floaterState.range.from) {
                        floaterState = {...floaterState, isClosing: true};
                    }
                    // If the head of our selection left the end of our mention range...
                    else if (newState.selection.head > floaterState.range.to) {
                        // We want to extend the mention range if the user is typing within the mention and
                        // extending the search query. We want to cancel the mention range if the user is
                        // explicitly moving their selection outside of the mention range.
                        //
                        // We use the heuristic that if both the document changed and the selection was
                        // explicitly set in our transaction that indicates the user is typing (or pasting
                        // or similar). This isn't perfect. Ideally we'd also check that this came from our
                        // client (and not a collaborative edit) or that the document change happened
                        // inside our mention range.
                        //
                        // If the user pasted multiple paragraphs of content then our floater state will be
                        // cleaned up below.
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

                // Compute the new search query for our mention floater and put it in our state. If
                // the mention range does not have a valid search query then we will reset our
                // floater state here.
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

                            // Close the floater if user types another instance of the trigger character.
                            if (searchQuery.includes(floaterState.triggerCharacter)) {
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

// We store content references in a plugin on our `ContentEditorState` so that it
// is updated in lockstep with the underlying doc.
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
                const action:
                    | ContentEditorReferencesAction<References>
                    | Array<ContentEditorReferencesAction<References>>
                    | undefined = transaction.getMeta(contentEditorReferencesPluginKey);

                const newReferences = Array.isArray(action)
                    ? action.reduce(reduceReferences, oldPluginState.references)
                    : action
                      ? reduceReferences(oldPluginState.references, action)
                      : oldPluginState.references;

                if (newReferences === oldPluginState.references && !transaction.docChanged)
                    return oldPluginState;

                // We maintain a `ContentWithReferences` object in our plugin (instead of just
                // `ContentReferences`) so that the we can have a memoized object reference that
                // won't break any `useMemo()`s that listen to it on spurious changes.
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
    action:
        | ContentEditorReferencesAction<References>
        | Array<ContentEditorReferencesAction<References>>,
): Transaction {
    if (Array.isArray(action) && action.length === 0) return transaction;

    const previousActions = transaction.getMeta(contentEditorReferencesPluginKey);
    if (!previousActions) {
        return transaction.setMeta(contentEditorReferencesPluginKey, action);
    } else {
        return transaction.setMeta(contentEditorReferencesPluginKey, [
            ...(Array.isArray(previousActions) ? previousActions : [previousActions]),
            ...(Array.isArray(action) ? action : [action]),
        ]);
    }
}

export function hasContentEditorReferencesUpdate(transaction: Transaction): boolean {
    return !!transaction.getMeta(contentEditorReferencesPluginKey);
}

export type ContentEditorReferencesAction<References extends ContentReferences> =
    | ContentEditorReferencesMergeAction<References>
    | ContentEditorReferencesSharedAction
    | ContentEditorReferencesUpdateDocumentCommentThreadAction;

export type ContentEditorReferencesSharedAction =
    | ContentEditorReferencesMergeBaseAction
    | ContentEditorReferencesSetAccountAction
    | ContentEditorReferencesSetSearchEntityAction
    | ContentEditorReferencesSetFileAction
    | ContentEditorReferencesSetFileSignedUrlSearchAction;

export type ContentEditorReferencesMergeAction<References extends ContentReferences> = {
    readonly type: "Merge";
    readonly references: References;
};

export type ContentEditorReferencesMergeBaseAction = {
    readonly type: "MergeBase";
    readonly references: ContentReferences;
};

export type ContentEditorReferencesSetAccountAction = {
    readonly type: "SetAccount";
    readonly account: AccountModel;
};

export type ContentEditorReferencesSetSearchEntityAction = {
    readonly type: "SetSearchEntity";
    readonly entityId: SearchMentionEntityId;
    readonly entity:
        | {readonly isPrivate: false; readonly entity: SearchEntityModel}
        | {readonly isPrivate: true};
};

export type ContentEditorReferencesSetFileAction = {
    readonly type: "SetFile";
    readonly signedUrlSearch: string;
    readonly file: FileModel;
};

export type ContentEditorReferencesSetFileSignedUrlSearchAction = {
    readonly type: "SetFileSignedUrlSearch";
    readonly fileId: FileId;
    readonly signedUrlSearch: string;
};

/**
 * This action is designed to be idempotent and runnable out-of-order. You can run
 * it as often as you'd like. You can run it optimistically and then run it again
 * after you get a response back from the server. References will converge to the
 * correct value.
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
        // These actions are only used with `DocumentContentReferences`.
        case "UpdateDocumentCommentThread":
            return references;
        default:
            return reduceContentReferencesShared(references, action);
    }
}

export function reduceContentReferencesShared<References extends ContentReferences>(
    references: References,
    action: ContentEditorReferencesSharedAction,
): Replace<References, ContentReferences> {
    switch (action.type) {
        case "MergeBase": {
            const newReferences = mergeContentReferences(references, action.references);
            if (newReferences === references) return references;
            return {...references, ...newReferences};
        }
        case "SetAccount": {
            const oldAccount = references.accountById.get(action.account.id);
            const newAccount = oldAccount ? oldAccount.merge(action.account) : action.account;
            if (oldAccount === newAccount) return references;

            const newAccountById = new Map(references.accountById);
            newAccountById.set(newAccount.id, newAccount);
            return {...references, accountById: newAccountById};
        }
        case "SetSearchEntity": {
            const oldEntity = references.searchEntityById.get(action.entityId);

            let newEntity: ContentReferencesSearchEntity;
            if (!oldEntity) {
                newEntity = action.entity;
            } else if (action.entity.isPrivate) {
                newEntity = oldEntity;
            } else if (oldEntity.isPrivate) {
                newEntity = action.entity;
            } else {
                newEntity = {
                    isPrivate: false,
                    entity: oldEntity.entity.merge(action.entity.entity),
                };
            }

            if (oldEntity === newEntity) return references;

            const newEntityById = new Map(references.searchEntityById);
            newEntityById.set(action.entityId, newEntity);
            return {...references, searchEntityById: newEntityById};
        }
        case "SetFile": {
            const oldFileReference = references.fileById?.get(action.file.id);

            // Prefer `oldFile` in `FileModel.minLoadingCount()` to avoid unnecessary
            // re-renders.
            const newFile = oldFileReference
                ? FileModel.minLoadingCount(oldFileReference.file, action.file)
                : action.file;

            // Pick the `signedUrlSearch` that expires later.
            const newSignedUrlSearch = oldFileReference
                ? mergeContentReferencesFileSignedUrlSearches(
                      oldFileReference.signedUrlSearch,
                      action.signedUrlSearch,
                  )
                : action.signedUrlSearch;

            if (
                oldFileReference?.file === newFile &&
                oldFileReference.signedUrlSearch === newSignedUrlSearch
            ) {
                return references;
            }

            const newFileById = new Map(references.fileById);
            newFileById.set(newFile.id, {signedUrlSearch: newSignedUrlSearch, file: newFile});
            return {...references, fileById: newFileById};
        }
        case "SetFileSignedUrlSearch": {
            const oldFileReference = references.fileById?.get(action.fileId);
            if (!oldFileReference) return references;

            // Pick the `signedUrlSearch` that expires later.
            const newSignedUrlSearch = oldFileReference
                ? mergeContentReferencesFileSignedUrlSearches(
                      oldFileReference.signedUrlSearch,
                      action.signedUrlSearch,
                  )
                : action.signedUrlSearch;

            if (oldFileReference.signedUrlSearch === newSignedUrlSearch) {
                return references;
            }

            const newFileById = new Map(references.fileById);
            newFileById.set(action.fileId, {
                ...oldFileReference,
                signedUrlSearch: newSignedUrlSearch,
            });
            return {...references, fileById: newFileById};
        }
        default:
            throw exhaustive(action);
    }
}

type ContentEditorQuickUndoPluginState = {
    readonly key: "Mod-z" | "Backspace";
    readonly pos: number;
    readonly command: (
        state: EditorState,
        dispatch: ((transaction: Transaction) => void) | undefined,
        pos: number,
    ) => boolean;
};

const contentEditorQuickUndoPluginKey = new PluginKey<ContentEditorQuickUndoPluginState | null>(
    "contentEditorQuickUndo",
);

function contentEditorQuickUndoPlugin() {
    return new Plugin<ContentEditorQuickUndoPluginState | null>({
        key: contentEditorQuickUndoPluginKey,
        state: {
            init: () => null,
            apply: (transaction, quickUndoState) => {
                const newQuickUndoState = transaction.getMeta(contentEditorQuickUndoPluginKey);
                if (newQuickUndoState) return newQuickUndoState;

                // Ignore transactions that aren't added to undo/redo history. This is a heuristic
                // for edits made not by our user. For example, [collaborative edits set
                // `addToHistory` to false][1].
                //
                // [1]:
                //     https://github.com/ProseMirror/prosemirror-collab/blob/c019e4cd1e05504d403d98e6bfec67fe1a80c895/src/collab.ts#L150
                if (transaction.getMeta("addToHistory") === false) {
                    if (!quickUndoState) return null;

                    const newPos = transaction.mapping.map(quickUndoState.pos);
                    if (newPos === quickUndoState.pos) return quickUndoState;

                    return {...quickUndoState, pos: newPos};
                }

                // If the selection moved or document changed then throw away our quick undo. It
                // might not work anymore on the new document.
                return transaction.selectionSet || transaction.docChanged ? null : quickUndoState;
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
    key: "Mod-z" | "Backspace",
    pos: number,
    command: (
        state: EditorState,
        dispatch: ((transaction: Transaction) => void) | undefined,
        pos: number,
    ) => boolean,
): Transaction {
    return transaction.setMeta(contentEditorQuickUndoPluginKey, {key, pos, command});
}

/**
 * If there is a quick undo entry then execute it.
 */
export const contentEditorQuickUndoCommand: (key: "Mod-z" | "Backspace") => Command =
    key => (state, dispatch) => {
        const quickUndoState = contentEditorQuickUndoPluginKey.getState(state);
        if (quickUndoState?.key === key) {
            return quickUndoState.command(state, dispatch, quickUndoState.pos);
        }

        return false;
    };

type ContentEditorRetypedInputRuleState = {
    readonly inputRuleId: Id;
    readonly replacementStart: number;
    readonly replacementString: string;
    readonly replacedString: string;
};

const contentEditorRetypedInputRulePluginKey =
    new PluginKey<ContentEditorRetypedInputRuleState | null>("contentEditorRetypedInputRule");

function contentEditorRetypedInputRulePlugin() {
    return new Plugin<ContentEditorRetypedInputRuleState | null>({
        key: contentEditorRetypedInputRulePluginKey,
        state: {
            init: () => null,
            apply: (transaction, state) => {
                const newState = transaction.getMeta(contentEditorRetypedInputRulePluginKey);
                if (newState) return newState;

                if (!state) return null;

                const selection = transaction.selection;

                const replacementStart = transaction.mapping.map(state.replacementStart);

                const replacementEnd =
                    replacementStart +
                    Math.max(state.replacementString.length, state.replacedString.length);

                const isSelectionInBounds =
                    replacementStart <= selection.from &&
                    selection.from <= replacementEnd &&
                    replacementStart <= selection.to &&
                    selection.to <= replacementEnd;

                // If the selection is out-of-bounds of the replacement, clear state.
                if (!isSelectionInBounds) return null;

                const retypedString = transaction.doc.textBetween(replacementStart, selection.to);

                // The retyped string must be the same as the string our input rule replaced in
                // order for our retyping state to prevent the input rule from being applied again.
                if (
                    !state.replacedString.startsWith(retypedString) &&
                    !state.replacementString.startsWith(retypedString)
                ) {
                    return null;
                }

                return replacementStart !== state.replacementStart
                    ? {...state, replacementStart}
                    : state;
            },
        },
    });
}

/**
 * When an input rule is applied, keep track of whether the user retypes the exact
 * same input rule. If they do then we don't want to apply the input rule a second
 * time.
 */
export function trackContentEditorRetypedInputRule(
    transaction: Transaction,
    state: ContentEditorRetypedInputRuleState,
): Transaction {
    return transaction.setMeta(contentEditorRetypedInputRulePluginKey, state);
}

/**
 * Is the user retyping the input rule with this `Id`? If true then we shouldn't
 * apply the input rule a second time.
 */
export function isContentEditorRetypingInputRule(state: EditorState, inputRuleId: Id): boolean {
    return contentEditorRetypedInputRulePluginKey.getState(state)?.inputRuleId === inputRuleId;
}

const contentEditorIsContinuouslyTypingPluginKey = new PluginKey<boolean>(
    "contentEditorIsContinuouslyTyping",
);

/**
 * Plugin that detects if a user is continuously typing in their content editor.
 * True if the user is typing and false when the user finishes typing. Will be
 * false if the user is only moving their selection around.
 */
function contentEditorIsContinuouslyTypingPlugin() {
    return new Plugin<boolean>({
        key: contentEditorIsContinuouslyTypingPluginKey,
        state: {
            init: () => false,
            apply: (transaction, isContinuouslyTyping, oldState, newState) => {
                // Ignore transactions that aren't added to undo/redo history. This is a heuristic
                // for edits made not by our user. For example, [collaborative edits set
                // `addToHistory` to false][1].
                //
                // [1]:
                //     https://github.com/ProseMirror/prosemirror-collab/blob/c019e4cd1e05504d403d98e6bfec67fe1a80c895/src/collab.ts#L150
                if (transaction.getMeta("addToHistory") === false) return isContinuouslyTyping;

                if (oldState.selection.from !== oldState.selection.to) return false;
                if (newState.selection.from !== newState.selection.to) return false;

                const selectionDifference = newState.selection.from - oldState.selection.from;
                const nodeSizeDifference = newState.doc.nodeSize - oldState.doc.nodeSize;

                return selectionDifference === nodeSizeDifference;
            },
        },
    });
}

export function isContinuouslyTypingInContentEditor(state: EditorState): boolean {
    return !!contentEditorIsContinuouslyTypingPluginKey.getState(state);
}

const contentEditorSelectionGenerationPluginKey = new PluginKey<number>(
    "contentEditorSelectionGeneration",
);

/**
 * Plugin that records the selection generation. The selection generation changes
 * whenever the selection is explicitly changed with `transaction.setSelection()`.
 * The generation doesn't change if the selection moves due to some other user
 * typing above the selection in the document (which causes the selection to be
 * mapped).
 */
function contentEditorSelectionGeneration() {
    return new Plugin<number>({
        key: contentEditorSelectionGenerationPluginKey,
        state: {
            init: () => 0,
            apply: (transaction, generation) => {
                if (transaction.selectionSet) return generation + 1;
                return generation;
            },
        },
    });
}

export function getContentEditorSelectionGeneration(state: EditorState): number {
    return contentEditorSelectionGenerationPluginKey.getState(state)!;
}

// Use an `ImmutableMap` since we'll need to `set()` every selection in the map
// very often and we'll need to `get()` results from the map very rarely.
type ContentEditorRememberPosWhileLoadingPluginState = ImmutableMap<
    number,
    | {
          readonly type: "Pos";
          readonly promise: Promise<unknown>;
          readonly pos: number;
      }
    | {
          readonly type: "Selection";
          readonly promise: Promise<unknown>;
          readonly selection: Selection;
      }
>;

const contentEditorRememberPosWhileLoadingPluginKey =
    new PluginKey<ContentEditorRememberPosWhileLoadingPluginState>(
        "contentEditorRememberPosWhileLoading",
    );

/**
 * Sometimes the user triggers an action, we need to asynchronously process some
 * data, then we can perform the action. For example, pasting some content that
 * contains mentions (we need to fetch mention data) or dropping a file (we need to
 * upload the file). In these cases frequently we want to perform the action on the
 * user's selection when they triggered the action. So if the user triggers an
 * action, then moves their selection, we apply the action result to their original
 * selection.
 *
 * This plugin gives us this capability. It allows us to register a promise we want
 * to keep track of. Whenever the document changes we map the selection keeping it
 * relative to the current document node. When the promise resolves or rejects we
 * remove the promise from our state. At any point between registering the promise
 * and the promise resolving you may get the mapped selection for the promise
 * representing the original position of the user's action.
 */
function contentEditorRememberPosWhileLoadingPlugin() {
    return new Plugin<ContentEditorRememberPosWhileLoadingPluginState>({
        key: contentEditorRememberPosWhileLoadingPluginKey,
        state: {
            init: () => ImmutableMap.empty(),
            apply: (transaction, pluginState) => {
                const action = transaction.getMeta(contentEditorRememberPosWhileLoadingPluginKey);
                if (action) {
                    if (action.type === "add") {
                        pluginState = pluginState.set(action.key, action.value);
                    } else if (action.type === "delete") {
                        pluginState = pluginState.delete(action.key);
                    } else {
                        throw new InternalError(quote`Unrecognized action type ${action.type}`);
                    }
                }

                if (!transaction.docChanged) return pluginState;

                return pluginState.updateEvery(entry => {
                    switch (entry.type) {
                        case "Pos": {
                            const newPos = transaction.mapping.map(entry.pos);
                            if (newPos === entry.pos) return entry;
                            return {
                                type: "Pos",
                                promise: entry.promise,
                                pos: newPos,
                            };
                        }
                        case "Selection": {
                            const newSelection = entry.selection.map(
                                transaction.doc,
                                transaction.mapping,
                            );
                            if (newSelection === entry.selection) {
                                return entry;
                            }
                            return {
                                type: "Selection",
                                promise: entry.promise,
                                selection: newSelection,
                            };
                        }
                        default:
                            throw exhaustive(entry);
                    }
                });
            },
        },
    });
}

let nextContentEditorRememberPosWhileLoadingPluginStateKey = 1;

export function rememberContentEditorPosWhileLoading(
    view: EditorView,
    pos: number,
    promise: PromiseLike<unknown>,
): {getPos: () => number | null} {
    const key = nextContentEditorRememberPosWhileLoadingPluginStateKey;
    nextContentEditorRememberPosWhileLoadingPluginStateKey++;

    let initialTransaction: Transaction | null = view.state.tr.setMeta(
        contentEditorRememberPosWhileLoadingPluginKey,
        {
            type: "add",
            key,
            value: {
                type: "Pos",
                promise,
                pos,
            },
        },
    );

    const handleFinally = () => {
        // In case we're dealing with a `PromiseImmediate` that's already resolved.
        if (initialTransaction !== null) {
            initialTransaction = null;
            return;
        }

        view.dispatch(
            view.state.tr.setMeta(contentEditorRememberPosWhileLoadingPluginKey, {
                type: "delete",
                key,
            }),
        );
    };

    promise.then(handleFinally, handleFinally);

    if (initialTransaction !== null) {
        view.dispatch(initialTransaction);
        initialTransaction = null;
    }

    return {
        getPos: () => {
            const entry = contentEditorRememberPosWhileLoadingPluginKey
                .getState(view.state)
                ?.get(key);
            if (!entry) return null;
            assert(entry.type === "Pos");
            return entry.pos;
        },
    };
}

export function rememberContentEditorSelectionWhileLoading(
    view: EditorView,
    selection: Selection,
    promise: PromiseLike<unknown>,
): {getSelection: () => Selection | null} {
    assert(selection.$anchor.doc === view.state.doc);

    const key = nextContentEditorRememberPosWhileLoadingPluginStateKey;
    nextContentEditorRememberPosWhileLoadingPluginStateKey++;

    let initialTransaction: Transaction | null = view.state.tr.setMeta(
        contentEditorRememberPosWhileLoadingPluginKey,
        {
            type: "add",
            key,
            value: {
                type: "Selection",
                promise,
                selection,
            },
        },
    );

    const handleFinally = () => {
        // In case we're dealing with a `PromiseImmediate` that's already resolved.
        if (initialTransaction !== null) {
            initialTransaction = null;
            return;
        }

        view.dispatch(
            view.state.tr.setMeta(contentEditorRememberPosWhileLoadingPluginKey, {
                type: "delete",
                key,
            }),
        );
    };

    promise.then(handleFinally, handleFinally);

    if (initialTransaction !== null) {
        view.dispatch(initialTransaction);
        initialTransaction = null;
    }

    return {
        getSelection: () => {
            const entry = contentEditorRememberPosWhileLoadingPluginKey
                .getState(view.state)
                ?.get(key);
            if (!entry) return null;
            assert(entry.type === "Selection");
            return entry.selection;
        },
    };
}
