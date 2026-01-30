import classNames from "classnames";
import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {SpinnerGap} from "phosphor-react";
import {ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {
    AccountAvatarPileSize,
    accountAvatarPileSizes,
} from "~/client/web/accounts/account_avatar_pile_size.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Tooltip, TooltipProps} from "~/client/web/design/tooltip.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {backgroundColorVar, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {addRemLengths, negateRemLength, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function AccountAvatarPile({
    size = "6",
    topPreviewAccount = "Last",
    previewAccounts,
    accountCount = previewAccounts.length,
    getAllAccounts,
    lastAvatar,
}: {
    size?: AccountAvatarPileSize;
    topPreviewAccount?: "First" | "Last";
    previewAccounts: ReadonlyArray<AccountModel | AccountModelData>;
    accountCount?: number;
    getAllAccounts?: (limit: number) => MaybePromise<ReadonlyArray<AccountModel>>;
    lastAvatar?: ReactNode;
}) {
    const previewAccountIds = useMemo(
        () => new Set(previewAccounts.map(account => account.id)),
        [previewAccounts],
    );

    const {avatarOverlapWidth, borderWidth, overflowFontSize, overflowScale} =
        accountAvatarPileSizes[size];

    // Is there a last circle with some interactive element? Either a count of how
    // many additional accounts there are or some custom avatar.
    const hasLastAvatar: boolean =
        !!lastAvatar || (!!getAllAccounts && accountCount > previewAccounts.length);

    return (
        <Box
            display="flex"
            position="relative"
            zIndex="0"
            style={{
                paddingRight: addRemLengths(size, negateRemLength(spacing[avatarOverlapWidth])),
            }}
        >
            {previewAccounts.map((account, index) => (
                <Box
                    key={account.id}
                    height={size}
                    width={avatarOverlapWidth}
                    position="relative"
                    style={{
                        zIndex:
                            // If we're rendering the account count then don't put the first avatar on top
                            // since we shouldn't occlude the account count.
                            topPreviewAccount === "First" && !hasLastAvatar
                                ? previewAccounts.length - index
                                : 1 + index,
                    }}
                >
                    <AccountAvatar
                        account={account}
                        size={size}
                        backgroundBorderWidth={
                            previewAccounts.length > 1 || hasLastAvatar ? borderWidth : undefined
                        }
                    />
                </Box>
            ))}
            {lastAvatar ? (
                <Box
                    height={size}
                    width={avatarOverlapWidth}
                    position="relative"
                    style={{zIndex: 1 + previewAccounts.length}}
                >
                    <Box
                        height={size}
                        width={size}
                        borderRadius="full"
                        style={{
                            boxShadow: `0px 0px 0px ${borderWidth}px ${backgroundColorVar}`,
                        }}
                    >
                        <Box
                            height={size}
                            width={size}
                            borderRadius="full"
                            backgroundColor="grey-10"
                            color="grey-70"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            overflow="hidden"
                        >
                            {lastAvatar}
                        </Box>
                    </Box>
                </Box>
            ) : (
                getAllAccounts &&
                accountCount > previewAccounts.length && (
                    <Box
                        height={size}
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
                                    children.push(
                                        <AccountAvatarPileAccountName
                                            key={account.id}
                                            account={account}
                                        />,
                                    );
                                }

                                if (remainingAccountCount > 0) {
                                    children.push(
                                        <div key="more">
                                            and <PrettyNumber number={remainingAccountCount} />{" "}
                                            more…
                                        </div>,
                                    );
                                }

                                return <>{children}</>;
                            }}
                        >
                            <Box
                                height={size}
                                width={size}
                                borderRadius="full"
                                style={{
                                    boxShadow: `0px 0px 0px ${borderWidth}px ${backgroundColorVar}`,
                                }}
                            >
                                <Box
                                    height={size}
                                    width={size}
                                    borderRadius="full"
                                    backgroundColor="grey-10"
                                    color="grey-70"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                    overflow="hidden"
                                    fontSize={overflowFontSize}
                                >
                                    <span
                                        style={{
                                            transform: overflowScale
                                                ? `scale(${overflowScale})`
                                                : undefined,
                                        }}
                                    >
                                        +{accountCount - previewAccounts.length}
                                    </span>
                                </Box>
                            </Box>
                        </AsyncTooltip>
                    </Box>
                )
            )}
        </Box>
    );
}

function AsyncTooltip({
    getContent,
    ...tooltipProps
}: Omit<TooltipProps, "content" | "isDisabled"> & {getContent: () => Promise<ReactNode>}) {
    const reporter = useReporter();

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
                reporter.displayError("Couldn\u2019t get content", error);
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

function AccountAvatarPileAccountName({account}: {account: AccountModel}) {
    const {name} = useAccountModel(account);
    return <div>{name}</div>;
}
