import {Node} from "prosemirror-model";
import {Transaction} from "prosemirror-state";
import {ReplaceStep} from "prosemirror-transform";
import {EditorView} from "prosemirror-view";
import {createSpellCheckContent} from "~/client/web/content/internal/spell_check_content.js";
import {ContentSpellCheckLint} from "~/client/web/content/state/content_editor_spell_checker_configuration.js";
import {setContentEditorSpellCheckerLints} from "~/client/web/content/state/content_editor_spell_checker_plugin.js";
import {getContentEditorReferences} from "~/client/web/content/state/content_editor_state.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {getPlatformWithoutListening} from "~/client/web/remix/platform_context.js";
import {searchWordTypingDebounceMs} from "~/client/web/search/core/search_word_typing_debounce_ms.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Manages when spell checking runs for `<ContentEditor>`. As the user types we run
 * the spell checker after a debounce timeout or after the user presses space
 * signaling they've finished typing a word. Spell checking is asynchronous and we
 * only run one spell check at a time (managed via mutex).
 */
export class ContentEditorSpellChecker {
    private readonly _getContext: () => AppContext;
    private readonly _getAccessLevel: () => AccessLevel;
    private readonly _view: EditorView;
    private readonly _spellCheck: (content: Node) => Promise<Array<ContentSpellCheckLint>>;

    private _isDestroyed = false;
    private _debounceTimeout: Timeout | null = null;
    private _hasRequestedSpellCheck = false;
    private readonly _mutex = new Mutex();
    private _transactions: Array<Transaction> | null = null;

    private _spellCheckCount = 0;

    constructor({
        getContext,
        getAccessLevel,
        spaceId,
        view,
    }: {
        getContext: () => AppContext;
        getAccessLevel: () => AccessLevel;
        spaceId: SpaceId;
        view: EditorView;
    }) {
        this._getContext = getContext;
        this._getAccessLevel = getAccessLevel;
        this._view = view;

        this._spellCheck = createSpellCheckContent({
            spaceId,
            getContentReferences: () => getContentEditorReferences(view.state).references,
        });

        // Request an initial spell check.
        this._requestSpellCheck();
    }

    public destroy() {
        assert(!this._isDestroyed);
        this._isDestroyed = true;

        this._debounceTimeout?.clear();
        this._debounceTimeout = null;
    }

    public handleTransaction(transaction: Transaction) {
        assert(!this._isDestroyed);

        if (!transaction.docChanged) return;

        // If the user doesn't have edit access, immediately clear any existing lints and
        // return early. Lints are distracting for users who can't edit the document.
        if (!hasAccessLevel(this._getAccessLevel(), "Edit")) {
            this._view.dispatch(setContentEditorSpellCheckerLints(this._view.state.tr, []));
            return;
        }

        this._transactions?.push(transaction);

        let isTypingWord = false;

        if (transaction.steps.length === 1) {
            const step = transaction.steps[0]!;
            if (step instanceof ReplaceStep && step.slice.content.childCount === 1) {
                const node = step.slice.content.firstChild!;
                if (
                    node.isText &&
                    // A regex for everything on a standard qwerty keyboard except space. Created this
                    // by typing all the special keys on my keyboard.
                    /^[a-zA-Z0-9@#$%^&*()\-=[\]\\;',/_+{}|:"<>]$/.test(node.text!)
                ) {
                    isTypingWord = true;
                }
            }
        }

        this._debounceTimeout?.clear();
        this._debounceTimeout = null;

        // If the user is typing a word then we debounce spell check until they're done
        // typing. But if the user types space we immediately request a spell check since
        // we interpret that as signal they're done typing the previous word.
        //
        // Any standard qwerty keyboard character (except space and punctuation marks `.`,
        // `?`, and `!`) is considered to be word typing. If any other character or string
        // that's more than a single character is entered in the editor we consider that to
        // be non-word typing and request a spell check immediately.
        if (!isTypingWord) {
            this._requestSpellCheck();
            return;
        }

        this._debounceTimeout = createTimeout(() => {
            this._debounceTimeout = null;
            this._requestSpellCheck();
        }, searchWordTypingDebounceMs[getPlatformWithoutListening()]);
    }

    private _requestSpellCheck() {
        // If a spell check has already been requested (but hasn't run because the mutex is
        // processing another spell check) then don't request a new spell check.
        if (this._hasRequestedSpellCheck) return;
        this._hasRequestedSpellCheck = true;

        this._mutex
            .withLock(async () => {
                // Allow another spell check to be requested while a spell check is running.
                this._hasRequestedSpellCheck = false;

                await this._runSpellCheck();

                if (process.env.NODE_ENV === "test") {
                    this._spellCheckCount++;
                }
            })
            .catch(error => {
                // If there was an error, silently log the error but don't show anything to the
                // user since there's nothing they can really do if spell check isn't working.
                this._getContext().tracer.logException("Content spell check failed", error);
            });
    }

    private async _runSpellCheck() {
        assert(this._transactions === null);

        // Only run spell check if the user has edit access. Lints are distracting for
        // users who can't edit the document.
        if (!hasAccessLevel(this._getAccessLevel(), "Edit")) return;

        const transactions: Array<Transaction> = [];
        this._transactions = transactions;

        try {
            const lints = await this._spellCheck(this._view.state.doc);

            // If our checker was destroyed while we were running the spell check, exit.
            if (this._isDestroyed) return;

            // If there were any transactions during our spell check run then we need to map
            // lint positions to their current positions in the document.
            const mappedLints = filterMapArray(lints, lint => {
                for (const transaction of transactions) {
                    lint = {
                        key: lint.key,
                        from: transaction.mapping.map(lint.from, 1),
                        to: transaction.mapping.map(lint.to, -1),
                        kind: lint.kind,
                        category: lint.category,
                        suggestions: lint.suggestions,
                    };

                    // If the lint range is now empty, it's because the content was deleted during the
                    // lint.
                    if (lint.from === lint.to) return;
                }

                return lint;
            });

            this._view.dispatch(
                setContentEditorSpellCheckerLints(this._view.state.tr, mappedLints),
            );
        } finally {
            this._transactions = null;
        }
    }

    public getSpellCheckCountForTest() {
        assert(process.env.NODE_ENV === "test");
        return this._spellCheckCount;
    }
}
