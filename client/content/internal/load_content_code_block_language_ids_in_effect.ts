import {contentCodeBlockLanguageById} from "~/client/content/code/content_code_block_language.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

let contentCodeBlockLanguageState: {
    isBrowserActive: boolean;
    loadingLanguageIds: Set<ContentCodeBlockLanguageId>;
    rejectedLanguageIds: Set<ContentCodeBlockLanguageId>;
} | null = null;

/**
 * Load the parsers for unloaded code block languages. This function is
 * idempotent and meant to be called in a `useEffect()`. When `onFinish` is
 * called you should re-render your component so it can pick up the newly
 * loaded language parsers.
 */
export function loadContentCodeBlockLanguageIdsInEffect(
    unloadedLanguageIds: ReadonlySet<ContentCodeBlockLanguageId>,
    {onLoaded, onError}: {onLoaded: () => void; onError: (error: unknown) => void},
) {
    if (unloadedLanguageIds.size === 0) return;

    const isBrowserActive = navigator.onLine && document.visibilityState === "visible";

    const state = (contentCodeBlockLanguageState ??= {
        isBrowserActive,
        loadingLanguageIds: new Set(),
        rejectedLanguageIds: new Set(),
    });

    // If the browser is activated (after being deactivated) clear our rejected
    // language set. This way we will retry loading any languages we failed to load
    // previously. This is useful, for instance, if the browser goes offline (so we
    // fail to load a language's parser) then comes back online.
    if (state.isBrowserActive !== isBrowserActive) {
        state.isBrowserActive = isBrowserActive;

        if (isBrowserActive) state.rejectedLanguageIds.clear();
    }

    const loadingLanguageIds: Array<ContentCodeBlockLanguageId> = [];
    for (const languageId of unloadedLanguageIds) {
        if (
            !state.loadingLanguageIds.has(languageId) &&
            !state.rejectedLanguageIds.has(languageId)
        ) {
            state.loadingLanguageIds.add(languageId);
            loadingLanguageIds.push(languageId);
        }
    }

    if (loadingLanguageIds.length > 0) {
        Promise.allSettled(
            loadingLanguageIds.map(languageId =>
                contentCodeBlockLanguageById[languageId].parser?.load(),
            ),
        ).then(results => {
            onLoaded();

            for (let i = 0; i < loadingLanguageIds.length; i++) {
                const languageId = loadingLanguageIds[i]!;
                const result = results[i]!;

                state.loadingLanguageIds.delete(languageId);

                if (result.status === "rejected") {
                    state.rejectedLanguageIds.add(languageId);

                    onError(result.reason);
                }
            }
            // `Promise.allSettled()` shouldn't fail. Instead it should return an array with
            // individual errors. So treat any errors as an uncaught exception.
        }, scheduleUncaughtError);
    }
}
