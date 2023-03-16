import classNames from "classnames";
import {differenceInMinutes} from "date-fns";
import {SpinnerGap} from "phosphor-react";
import {ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {PrettyNumber} from "~/client/design/pretty_number";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {Tooltip, TooltipProps} from "~/client/design/tooltip";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {addRemLengths, negateRemLength, spacing} from "~/shared/design/spacing";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {AccountModel} from "~/shared/models/account_model";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

export type AccountAvatarPileSize = "base" | "lg";

export function AccountAvatarPile({
    size = "base",
    previewAccounts,
    accountCount,
    getAllAccounts,
}: {
    size?: AccountAvatarPileSize;
    previewAccounts: ReadonlyArray<AccountModel>;
    accountCount: number;
    getAllAccounts: (limit: number) => MaybePromise<ReadonlyArray<AccountModel>>;
}) {
    const previewAccountIds = useMemo(
        () => new Set(previewAccounts.map(account => account.id)),
        [previewAccounts],
    );

    const {avatarSize, avatarOverlapWidth, borderWidth, overflowFontSize} = (
        {
            base: {
                avatarSize: "6",
                avatarOverlapWidth: "5",
                borderWidth: 2,
                overflowFontSize: "50",
            },
            lg: {
                avatarSize: "12",
                avatarOverlapWidth: "10",
                borderWidth: 3,
                overflowFontSize: "100",
            },
        } as const
    )[size];

    return (
        <Box
            display="flex"
            position="relative"
            zIndex="0"
            style={{
                paddingRight: addRemLengths(
                    spacing[avatarSize],
                    negateRemLength(spacing[avatarOverlapWidth]),
                ),
            }}
        >
            {previewAccounts.map((author, index) => (
                <Box
                    key={author.id}
                    height={avatarSize}
                    width={avatarOverlapWidth}
                    position="relative"
                    style={{zIndex: 1 + index}}
                >
                    <Box
                        height={avatarSize}
                        width={avatarSize}
                        borderRadius="full"
                        style={{
                            boxShadow: `0px 0px 0px ${borderWidth}px ${colorSchemeVars["grey-0"]}`,
                        }}
                    >
                        <AccountAvatar account={author} size={avatarSize} />
                    </Box>
                </Box>
            ))}
            {accountCount > previewAccounts.length && (
                <Box
                    height={avatarSize}
                    width={avatarOverlapWidth}
                    position="relative"
                    style={{zIndex: 1 + previewAccounts.length}}
                >
                    <AsyncTooltip
                        placement="bottom-start"
                        getContent={async () => {
                            let remainingAccountCount = accountCount;
                            const accounts = await getAllAccounts(100);

                            const children = [];

                            for (const account of accounts) {
                                remainingAccountCount--;
                                if (previewAccountIds.has(account.id)) continue;
                                children.push(<div key={account.id}>{account.name}</div>);
                            }

                            if (remainingAccountCount > 0) {
                                children.push(
                                    <div key="more">
                                        and <PrettyNumber number={remainingAccountCount} /> more…
                                    </div>,
                                );
                            }

                            return <>{children}</>;
                        }}
                    >
                        <Box
                            height={avatarSize}
                            width={avatarSize}
                            borderRadius="full"
                            style={{
                                boxShadow: `0px 0px 0px ${borderWidth}px ${colorSchemeVars["grey-0"]}`,
                            }}
                            backgroundColor="grey-10"
                            fontSize={overflowFontSize}
                            color="grey-70"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                        >
                            +{accountCount - previewAccounts.length}
                        </Box>
                    </AsyncTooltip>
                </Box>
            )}
        </Box>
    );
}

function AsyncTooltip({
    getContent,
    ...tooltipProps
}: Omit<TooltipProps, "content" | "isDisabled"> & {getContent: () => Promise<ReactNode>}) {
    const context = useAppContext();

    const [tooltipState, setTooltipState] = useState<
        {isHoveredOrFocused: false} | {isHoveredOrFocused: true; isTooltipOpenStalled: boolean}
    >({isHoveredOrFocused: false});

    const isLoadingRef = useRef(false);

    const [contentState, setContentState] = useState<
        {isLoaded: false} | {isLoaded: true; loadTime: Date; content: ReactNode}
    >({isLoaded: false});

    useEffect(() => {
        // Don't open the tooltip for a bit while we load content. After that open the
        // tooltip with a loading spinner.
        if (tooltipState.isHoveredOrFocused && tooltipState.isTooltipOpenStalled) {
            const timeoutId = setTimeout(() => {
                setTooltipState({
                    isHoveredOrFocused: true,
                    isTooltipOpenStalled: false,
                });
            }, delayLoadingIndicatorLimitMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [tooltipState]);

    const loadContent = useEvent(() => {
        if (isLoadingRef.current) return;
        isLoadingRef.current = true;

        const loadTime = new Date();

        // Don't load the tooltip content again unless it has been more than five
        // minutes since the last time we loaded tooltip content.
        if (contentState.isLoaded && differenceInMinutes(loadTime, contentState.loadTime) < 5)
            return;

        runPromiseWithoutAwaiting(async () => {
            try {
                const content = await getContent();
                setContentState({isLoaded: true, loadTime, content});
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(error);

                // TODO(calebmer): This does not show the exception to the user! We should show
                // some kind of banner on error.
                context.tracer
                    .getRoot()
                    .logUncaughtException("Could not get tooltip content", error);
            } finally {
                isLoadingRef.current = false;
            }
        });
    });

    useEffect(() => {
        // Every time this tooltip is activated, load our content. If content was
        // previously loaded then we will show stale content while refetching.
        if (tooltipState.isHoveredOrFocused) {
            loadContent();
        }
    }, [loadContent, tooltipState.isHoveredOrFocused]);

    return (
        <Tooltip
            {...tooltipProps}
            isDisabled={
                !contentState.isLoaded &&
                (!tooltipState.isHoveredOrFocused || tooltipState.isTooltipOpenStalled)
            }
            content={
                contentState.isLoaded ? (
                    contentState.content
                ) : (
                    <Box height="4" width="4" padding="0.5">
                        <SpinnerGap
                            className={classNames(
                                sprinkles({position: "absolute"}),
                                spinAnimationClassName,
                            )}
                            color="currentColor"
                            size={spacing["3"]}
                        />
                    </Box>
                )
            }
            onStateChange={state => {
                if (state.isHovered || state.isFocused) {
                    setTooltipState(tooltipState => {
                        if (tooltipState.isHoveredOrFocused) return tooltipState;
                        return {isHoveredOrFocused: true, isTooltipOpenStalled: true};
                    });
                } else {
                    setTooltipState({isHoveredOrFocused: false});
                }

                tooltipProps.onStateChange?.(state);
            }}
        />
    );
}
