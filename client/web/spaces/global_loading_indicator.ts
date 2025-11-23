import {Memo, useContext, useEffect, useRef} from "react";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {GlobalLoadingIndicatorContext} from "~/client/web/spaces/internal/global_loading_indicator_context.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const mockGlobalLoadingIndicatorContextForTest: GlobalLoadingIndicatorContext | null = import.meta
    .jest
    ? {
          add: markMemoIfNotRendering(() => {
              // Adding loading indicators in Jest unit tests is a noop. Since there's no
              // visual output.
          }),
      }
    : null;

/**
 * Renders a global loading indicator for the duration of the provided promise.
 *
 * IMPORTANT: You should prefer inline loading indicators in all situations if
 * possible. Only use global loading indicators if there's no good inline
 * loading indicator design. For example, saving indicator on a document after
 * optimistic updates.
 */
export function useAddGlobalLoadingIndicator(): Memo<
    (promise: Promise<unknown>, indicator: GlobalLoadingIndicator) => void
> {
    const context = useContext(GlobalLoadingIndicatorContext);

    if (context === null) {
        // In Jest return a mock value instead of requiring a root context provider.
        if (import.meta.jest) {
            return assertExists(mockGlobalLoadingIndicatorContextForTest).add;
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<GlobalLoadingIndicatorContextProvider>`",
        );
    }

    return context.add;
}

/**
 * While this hook has a non-null `indicator` argument we'll show the provided
 * loading indicator.
 *
 * IMPORTANT: You should prefer inline loading indicators in all situations if
 * possible. Only use global loading indicators if there's no good inline
 * loading indicator design. For example, saving indicator on a document after
 * optimistic updates.
 */
export function useGlobalLoadingIndicator(indicator: Memo<GlobalLoadingIndicator> | null) {
    const add = useAddGlobalLoadingIndicator();

    const lastIndicatorRef = useRef<{
        promiseResolver: PromiseResolver<void>;
        indicator: GlobalLoadingIndicator;
        resolveTimeout: Timeout | null;
    } | null>(null);

    useEffect(() => {
        if (lastIndicatorRef.current !== null && lastIndicatorRef.current.indicator !== indicator) {
            lastIndicatorRef.current.resolveTimeout?.clear();
            lastIndicatorRef.current.resolveTimeout = null;
            lastIndicatorRef.current.promiseResolver.resolve();
            lastIndicatorRef.current = null;
        }

        if (indicator === null) return;

        if (lastIndicatorRef.current !== null) {
            lastIndicatorRef.current.resolveTimeout?.clear();
            lastIndicatorRef.current.resolveTimeout = null;
        } else {
            lastIndicatorRef.current = {
                promiseResolver: createPromiseResolver(),
                indicator,
                resolveTimeout: null,
            };

            add(lastIndicatorRef.current.promiseResolver.promise, indicator);
        }

        return () => {
            // If the effect immediately remounts with the same `indicator` then this
            // timeout will be cancelled and we won't resolve the current loading
            // indicator.
            if (lastIndicatorRef.current?.indicator === indicator) {
                lastIndicatorRef.current.resolveTimeout = createTimeout(() => {
                    if (lastIndicatorRef.current?.indicator === indicator) {
                        lastIndicatorRef.current.resolveTimeout = null;
                        lastIndicatorRef.current.promiseResolver.resolve();
                        lastIndicatorRef.current = null;
                    }
                }, 0);
            }
        };
    }, [add, indicator]);
}
