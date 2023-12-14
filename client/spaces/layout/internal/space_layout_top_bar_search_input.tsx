import {MagnifyingGlass} from "phosphor-react";
import {Component, ReactNode, useEffect, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {SearchModal} from "~/client/search/search_modal.js";
import {spacing} from "~/shared/design/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

// NOTE(calebmer): I've invested a lot of screen real estate for the search
// input. Even showing you the keyboard shortcut at all times. That's because
// I intend for search to be the primary means of navigation in the product.
// Instead of relying on careful, manual, organization whenever you need
// something you should be able to hit the search keyboard shortcut and jump to
// immediately from wherever you are.
//
// Users have been trained to hit Ctrl+S constantly to save. In Alpine they'll
// be trained to use Ctrl+S constantly to search. Though it may be worth
// finding a different keyboard shortcut we can use across the operating
// system when we have a desktop app.
export function SpaceLayoutTopBarSearchInput({space}: {space: SpaceModel}) {
    const {isAppleDevice} = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();

    const [searchState, setSearchState] = useState<{initialQueryText: string} | null>(null);

    // On initial render, if there's a `search` query parameter then open our
    // search modal.
    useEffect(() => {
        if (isInitialAppRender) return;

        const url = new URL(window.location.href);

        if (url.searchParams.has("search")) {
            const initialQueryText = url.searchParams.get("search") ?? "";

            setSearchState(searchState => {
                if (searchState) return searchState;
                return {initialQueryText};
            });
        }
    }, [isInitialAppRender]);

    const {pressProps} = usePress({
        onPress: () => {
            setSearchState(searchState => {
                if (searchState) return searchState;
                return {initialQueryText: ""};
            });
        },
    });

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (
                    event.key === "s" &&
                    !event.altKey &&
                    !event.shiftKey &&
                    (isAppleDevice
                        ? event.metaKey && !event.ctrlKey
                        : event.ctrlKey && !event.metaKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    setSearchState(searchState => {
                        if (searchState) return searchState;
                        return {initialQueryText: ""};
                    });
                }
            }}
        >
            <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                <Box
                    {...pressProps}
                    minWidth="48"
                    maxWidth="96"
                    width="full"
                    border="grey-10"
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    padding="1"
                    gap="1.5"
                    color="grey-50"
                    cursor="text"
                >
                    <MagnifyingGlass size={spacing["3"]} />
                    <Box fontStyle="truncate">Search {space.name}</Box>
                    <Box fontSize="50" color="grey-30">
                        {isAppleDevice ? "⌘+S" : "Ctrl+S"}
                    </Box>
                </Box>
                {searchState && (
                    <SearchModalErrorBoundary>
                        <SearchModal
                            initialQueryText={searchState.initialQueryText}
                            onClose={() => setSearchState(null)}
                        />
                    </SearchModalErrorBoundary>
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}

/**
 * Protect against infinite error loops with `<SearchModal>`. If
 * `<SearchModal>` errs on initial render while rendering we'll re-render at
 * the nearest error boundary which will attempt to render `<SearchModal>`
 * again because `search` is in the URL causing an infinite error loop. With
 * this error boundary if `<SearchModal>` errs, we make sure not to render it
 * again by clearing `search` from the URL.
 */
class SearchModalErrorBoundary extends Component<{children: ReactNode}> {
    public override componentDidCatch(error: unknown) {
        const url = new URL(window.location.href);
        url.searchParams.delete("search");

        // Silently update the URL without telling Remix so our components don't
        // re-render unnecessarily.
        window.history.replaceState(null, "", url);

        throw error;
    }

    public override render() {
        return this.props.children;
    }
}
