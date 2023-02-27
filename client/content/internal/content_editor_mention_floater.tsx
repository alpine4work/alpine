import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useMemo, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker";
import {Box} from "~/client/design/box";
import {OverlayRef} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useExpensivelyLoadAllSpaceAccounts} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {AccountModel} from "~/shared/models/account_model";
import {overlayFadeOutAnimationDurationMs, spinAnimationClassName} from "~/shared/styles/styles";

export function ContentEditorMentionFloater({
    state,
    viewRef,
    range,
    searchQuery,
    isClosing,
    onClose: _onActuallyClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    searchQuery: string;
    isClosing: boolean;
    onClose: () => void;
}) {
    const overlayRef = useRef<OverlayRef>(null);

    const onActuallyClose = useEvent(_onActuallyClose);
    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onActuallyClose();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onActuallyClose]);

    const allAccounts = useExpensivelyLoadAllSpaceAccounts();

    const searchedAccounts = useMemo(() => {
        if (!allAccounts) return null;
        if (searchQuery.length === 0) return allAccounts.accounts;
        return allAccounts.fuse.search(searchQuery).map(({item}) => item);
    }, [allAccounts, searchQuery]);

    const isLoading = allAccounts === null;
    const wasInitiallyLoading = useConstant(() => isLoading);
    const [shouldShowLoadingIndicatorIfLoading, setShouldShowLoadingIndicatorIfLoading] =
        useState(false);
    useEffect(() => {
        if (!isLoading) return;
        if (shouldShowLoadingIndicatorIfLoading) return;

        const timeout = createTimeout(() => {
            setShouldShowLoadingIndicatorIfLoading(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isLoading, shouldShowLoadingIndicatorIfLoading]);

    if (isLoading && !shouldShowLoadingIndicatorIfLoading) return null;

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // However, we do want to animate in if we are loading.
            isVisible={!isClosing}
            disableAnimation={!wasInitiallyLoading && !isClosing}
            placement="bottom-start"
            offset="3"
            overlay={
                // TODO(calebmer): This should eventually be virtualized. Probably at the same
                // time we add a proper search backend for mentions?
                <Box
                    width="48"
                    maxHeight="64"
                    overflowY="scroll"
                    borderRadius="md"
                    padding="1"
                    backgroundColor={{light: "grey-0", dark: "grey-5"}}
                    border={{light: "grey-0", dark: "grey-10"}}
                    boxShadow="elevation-20"
                >
                    {isLoading && shouldShowLoadingIndicatorIfLoading ? (
                        <Box paddingX="1.5" paddingY="1.5" display="flex" justifyContent="center">
                            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                        </Box>
                    ) : !searchedAccounts || searchedAccounts.length === 0 ? (
                        <Box
                            paddingX="1.5"
                            paddingY="1.5"
                            display="flex"
                            alignItems="center"
                            gap="2"
                            color="grey-70"
                        >
                            <Box padding="1">
                                <MagnifyingGlass size={spacing["4"]} />
                            </Box>
                            <Box>No results</Box>
                        </Box>
                    ) : (
                        searchedAccounts?.map(account => (
                            <ContentEditorMentionAccountItem key={account.id} account={account} />
                        ))
                    )}
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorMentionAccountItem({account}: {account: AccountModel}) {
    const {isHovered, hoverProps} = useHover({});

    const {isPressed, pressProps} = usePress({
        onPress: () => {},
    });

    return (
        <Box
            {...mergeProps(hoverProps, pressProps)}
            paddingX="1.5"
            paddingY="1.5"
            borderRadius="base"
            display="flex"
            alignItems="center"
            gap="2"
            backgroundColor={
                isPressed
                    ? {light: "grey-10", dark: "grey-20"}
                    : isHovered
                    ? {light: "grey-5", dark: "grey-10"}
                    : undefined
            }
        >
            <AccountAvatar account={account} size="6" />
            <Box fontStyle="truncate">{account.name}</Box>
        </Box>
    );
}
