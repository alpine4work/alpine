import {ArrowUpRight, CaretDown, CaretUp, Check} from "phosphor-react";
import {ReactNode, useCallback, useEffect, useMemo, useRef} from "react";
import {createPath, useLocation} from "react-router";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useRynamoItemBase} from "~/client/web/dynamo/use_rynamo_item.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useWaitForState} from "~/client/web/helpers/use_wait_for_state.js";
import {subscribeToArchiveInboxChannelPostsEntryPostOptimistically} from "~/client/web/inbox/archive_inbox_channel_posts_entry_post_optimistically.js";
import {subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically} from "~/client/web/inbox/archive_inbox_document_new_comment_threads_entry_comment_thread_optimistically.js";
import {
    subscribeToArchiveInboxEntryOptimistically,
    subscribeToUnarchiveInboxEntryOptimistically,
    useArchiveInboxEntry,
    useUnarchiveInboxEntry,
} from "~/client/web/inbox/archive_inbox_entry_optimistically.js";
import {InboxContextNavigation} from "~/client/web/inbox/context/inbox_context_types.js";
import {InboxContextProvider} from "~/client/web/inbox/inbox_context_provider.js";
import {printInboxEntryDisplayContentSummaryWithoutInteractivityStore} from "~/client/web/inbox/internal/print_inbox_entry_display_content_summary_without_interactivity_store.js";
import {useNavigationState} from "~/client/web/navigation/navigation_state_context.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {inboxBannerHeight} from "~/client/web/styles/inbox_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {Spacing, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {createInboxDocumentCommentThreadEntryDynamoItemKey} from "~/shared/notifications/create_inbox_document_comment_thread_entry_dynamo_item_key.js";
import {createInboxPostCommentsEntryDynamoItemKey} from "~/shared/notifications/create_inbox_post_comments_entry_dynamo_item_key.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {
    InboxChannelPostsEntryModel,
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {convertPeekPathToSpacePath} from "~/shared/remix/peek_path_helpers.js";
import {getInboxEntryWithStrongReadConsistency} from "~/shared/rpc/notifications_rpc_definitions.js";

export function InboxBannerOutletContainer({
    initialEntry,
    parentEntry,
    navigation,
    maxWidth,
    withoutArchiveButton,
    children,
}: {
    initialEntry: RynamoItem<InboxEntryModel>;
    parentEntry: RynamoItem<InboxEntryModel> | null;
    navigation: InboxContextNavigation | null;
    maxWidth: Spacing | "full";
    withoutArchiveButton?: boolean;
    children?: ReactNode;
}) {
    const context = useAppContext();
    const rootNavigate = useRootNavigate();
    const navigate = useNavigate();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const clientInfo = useClientInfo();
    const {locale} = clientInfo;
    const location = useLocation();
    const accountRegistry = useAccountRegistry();
    const {space, currentAccount} = useSpaceContext();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const archiveInboxEntry = useArchiveInboxEntry();
    const unarchiveInboxEntry = useUnarchiveInboxEntry();
    const navigationState = useNavigationState();

    const doneButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [entry, updateEntry, actuallyUpdateEntryOptimistically, entryWithoutOptimisticUpdates] =
        useStateWithOptimisticUpdates<RynamoItem<InboxEntryModel> & {readonly isDeleted?: true}>(
            parentEntry ?? initialEntry,
        );

    // If the parent provided a newer version of the entry we're rendering then use the
    // parent's version.
    if (
        parentEntry &&
        parentEntry.key === entryWithoutOptimisticUpdates.key &&
        parentEntry.version > entryWithoutOptimisticUpdates.version
    ) {
        updateEntry(() => parentEntry);
    }

    const entryWithoutOptimisticUpdatesKey = useMemo(
        () => entryWithoutOptimisticUpdates.model.getKey(),
        [entryWithoutOptimisticUpdates.model],
    );

    const waitForEntryWithoutOptimisticUpdates = useWaitForState(entryWithoutOptimisticUpdates);

    const updateEntryOptimistically = useCallback(
        (
            promise: Promise<unknown>,
            update: (entry: RynamoItem<InboxEntryModel>) => RynamoItem<InboxEntryModel>,
        ) => {
            actuallyUpdateEntryOptimistically(
                promise.then(() =>
                    // Wait to resolve our optimistic update until we receive a realtime event that
                    // turns our optimistic update into a noop.
                    //
                    // That's because we don't trust that by the time `promise` resolves we've seen the
                    // realtime event from our WebSocket. `promise` may be from an RPC call which kicks
                    // off a background `NotificationEvent` job that eventually sends the realtime
                    // event we're looking for. We don't want to resolve our optimistic update until
                    // that background job finishes and we've seen the realtime event. Otherwise
                    // unrelated realtime events may overwrite our optimistic update causing the UI to
                    // glitch for the user.
                    waitForEntryWithoutOptimisticUpdates(entry => update(entry) === entry),
                ),
                update,
            );
        },
        [actuallyUpdateEntryOptimistically, waitForEntryWithoutOptimisticUpdates],
    );

    const isInboxEntryTask = entry.model.type === "Task";

    useEffect(() => {
        return subscribeToArchiveInboxEntryOptimistically(event => {
            updateEntryOptimistically(event.promise, entry => {
                if (entry.key !== event.entry.key) return entry;
                if (entry.version > event.entry.version) return entry;
                if (entry.model.isArchived) return entry;

                return {
                    ...entry,
                    version: entry.version + 1,
                    model: entry.model.clone({isArchived: true}),
                };
            });
        });
    }, [updateEntryOptimistically, waitForEntryWithoutOptimisticUpdates]);

    useEffect(() => {
        return subscribeToUnarchiveInboxEntryOptimistically(event => {
            updateEntryOptimistically(event.promise, entry => {
                if (entry.key !== event.entry.key) return entry;
                if (entry.version > event.entry.version) return entry;
                if (!entry.model.isArchived) return entry;

                return {
                    ...entry,
                    version: entry.version + 1,
                    model: entry.model.clone({isArchived: false}),
                };
            });
        });
    }, [updateEntryOptimistically, waitForEntryWithoutOptimisticUpdates]);

    // If we're archiving the last post in a `ChannelPosts` inbox entry then we need to
    // replace the `ChannelPosts` entry with an archived `PostComments` entry since the
    // `ChannelPosts` entry will be deleted on the server!
    useEffect(() => {
        return subscribeToArchiveInboxChannelPostsEntryPostOptimistically(event => {
            if (event.entryKey !== entry.key) return;
            if (!(entry.model instanceof InboxChannelPostsEntryModel)) return;
            if (entry.model.postIds.size !== 1) return;
            if (!entry.model.postIds.has(event.postId)) return;

            const replaceItem = {
                key: createInboxPostCommentsEntryDynamoItemKey(
                    entry.model.spaceId,
                    entry.model.accountId,
                    event.postId,
                ),
                // Replace this item with the first item we see from the server with real data.
                version: -1,
                model: new InboxPostCommentsEntryModel({
                    isArchived: true,
                    loudNotificationCount: 0,
                    spaceId: entry.model.spaceId,
                    accountId: entry.model.accountId,
                    postId: event.postId,
                    channel: entry.model.channel,
                    postAuthor: entry.model.latestPost.author,
                    postCreatedTime: entry.model.latestPost.createdTime,
                    postContentTextSnippet: entry.model.latestPost.contentTextSnippet,
                    isForPostContentMention: false,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            };

            actuallyUpdateEntryOptimistically(
                event.promise.then(() =>
                    // Wait for the entry to be deleted in realtime before we fully replace the entry
                    // for real.
                    waitForEntryWithoutOptimisticUpdates(entry => entry.isDeleted ?? false),
                ),
                () => replaceItem,
            );
        });
    }, [
        actuallyUpdateEntryOptimistically,
        entry,
        updateEntry,
        waitForEntryWithoutOptimisticUpdates,
    ]);

    // If we're archiving the last post in a `DocumentNewCommentThreads` inbox entry
    // then we need to replace the `DocumentNewCommentThreads` entry with an archived
    // `DocumentCommentThread` entry since the `DocumentNewCommentThreads` entry will
    // be deleted on the server!
    useEffect(() => {
        return subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
            event => {
                if (event.entryKey !== entry.key) return;
                if (!(entry.model instanceof InboxDocumentNewCommentThreadsEntryModel)) return;
                if (entry.model.commentThreadIds.size !== 1) return;
                if (!entry.model.commentThreadIds.has(event.commentThreadId)) return;

                const replaceItem = {
                    key: createInboxDocumentCommentThreadEntryDynamoItemKey(
                        entry.model.spaceId,
                        entry.model.accountId,
                        entry.model.getDocumentId(),
                        event.commentThreadId,
                    ),
                    // Replace this item with the first item we see from the server with real data.
                    version: -1,
                    model: new InboxDocumentCommentThreadEntryModel({
                        isArchived: true,
                        loudNotificationCount: 0,
                        spaceId: entry.model.spaceId,
                        accountId: entry.model.accountId,
                        document: entry.model.document,
                        commentThreadId: event.commentThreadId,
                        firstCommentAuthor: entry.model.firstCommentThread.author,
                        latestComment: {
                            author: entry.model.firstCommentThread.author,
                            createdTime: entry.model.firstCommentThread.createdTime,
                            index: 0,
                            contentTextSnippet: entry.model.firstCommentThread.contentTextSnippet,
                            isStickyMention: false,
                        },
                        otherCommentAuthor: null,
                        isFromNewCommentThread: true,
                    }),
                };

                actuallyUpdateEntryOptimistically(
                    event.promise.then(() =>
                        // Wait for the entry to be deleted in realtime before we fully replace the entry
                        // for real.
                        waitForEntryWithoutOptimisticUpdates(entry => entry.isDeleted ?? false),
                    ),
                    () => replaceItem,
                );
            },
        );
    }, [
        actuallyUpdateEntryOptimistically,
        entry,
        updateEntry,
        waitForEntryWithoutOptimisticUpdates,
    ]);

    const withoutReloadItem: boolean =
        !!parentEntry && parentEntry.key === entryWithoutOptimisticUpdates.key;

    useRynamoItemBase(
        {item: entryWithoutOptimisticUpdates, onUpdateItem: updateEntry},
        {
            isConnected,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event.events)),
                [subscribeToEvents],
            ),
            reloadItemWithStrongReadConsistency: useCallback(async () => {
                // We don't need to reload the item if we were provided a `parentEntry`. Since the
                // `parentEntry` is kept up-to-date in realtime. So we know we have the latest
                // data.
                if (withoutReloadItem) return;

                const {entry} = await getInboxEntryWithStrongReadConsistency(context, {
                    spaceId: space.id,
                    key: entryWithoutOptimisticUpdatesKey,
                });
                return entry;
            }, [context, entryWithoutOptimisticUpdatesKey, space.id, withoutReloadItem]),
        },
    );

    const entryDisplay = useMemo(
        () => getInboxEntryDisplayContent({entry: entry.model, locale, currentAccount}),
        [currentAccount, entry.model, locale],
    );

    const entryDisplaySummaryText = useStore(
        useMemo(
            () =>
                printInboxEntryDisplayContentSummaryWithoutInteractivityStore(
                    accountRegistry,
                    entryDisplay.title,
                ),
            [accountRegistry, entryDisplay.title],
        ),
    );

    const handleDoneButtonPress = async () => {
        if (!entry.model.isArchived) {
            archiveInboxEntry({
                entry,
                withAnimation: true,
            });

            if (!navigation && routeLayout === "narrow") {
                // Navigate back, if this is in a peek we'll close the peek. If this is on mobile
                // or we have no previous entries in browser history we'll go back to inbox.
                //
                // If this is a wide layout (desktop) then that's because the user expanded the
                // notification. Don't navigate if the user took an intentional action to expand
                // the peek.
                if (navigationState.hasPreviousLocation) {
                    await navigate(-1);
                } else {
                    await navigate(`/inbox/${entry.model.spaceId}`);
                }
            }

            if (navigation?.filter === "New") {
                if (navigation.nextEntry) {
                    await navigation.selectEntry(navigation.nextEntry);
                } else if (navigation.previousEntry) {
                    await navigation.selectEntry(navigation.previousEntry);
                } else {
                    await navigation.selectEntry(null);
                }
            }
        }
        // This button works as a toggle button. If you click it when the notification has
        // already been archived then we'll unarchive.
        else {
            unarchiveInboxEntry({
                entry,
                withAnimation: true,
            });

            if (navigation?.filter === "Done") {
                if (navigation.nextEntry) {
                    await navigation.selectEntry(navigation.nextEntry);
                } else if (navigation.previousEntry) {
                    await navigation.selectEntry(navigation.previousEntry);
                } else {
                    await navigation.selectEntry(null);
                }
            }
        }
    };

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (
                    event.key === "d" &&
                    (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    if (!entry.model.isArchived) {
                        // Programmatically click the button to correctly handle loading and error states.
                        if (doneButtonRef.current) {
                            doneButtonRef.current.press();
                        }
                        // If `doneButtonRef` isn't rendered then call `archiveInboxEntry()` directly.
                        else {
                            archiveInboxEntry({
                                entry,
                                withAnimation: true,
                            });

                            if (navigation) {
                                if (navigation.nextEntry) {
                                    void navigation.selectEntry(navigation.nextEntry);
                                } else if (navigation.previousEntry) {
                                    void navigation.selectEntry(navigation.previousEntry);
                                } else {
                                    void navigation.selectEntry(null);
                                }
                            }
                        }
                    } else if (navigation) {
                        // If the entry is already archived then move to the next entry.
                        if (navigation.nextEntry) {
                            void navigation.selectEntry(navigation.nextEntry);
                        } else if (navigation.previousEntry) {
                            void navigation.selectEntry(navigation.previousEntry);
                        }
                    } else {
                        // If the entry is already archived (e.g. because of a comment) we still want Cmd-D
                        // to close the peek so users can maintain that workflow.
                        navigate(-1);
                    }
                }
            }}
        >
            <Box
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                position="relative"
                zIndex="0"
                style={{
                    // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                    // like it.
                    "--safe-area-inset-top": `calc(var(--safe-area-inset-top-base, 0px) + ${spacing[inboxBannerHeight]})`,
                }}
            >
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    zIndex="50"
                    style={{paddingTop: "var(--safe-area-inset-top-base, 0px)"}}
                >
                    <Box
                        width="full"
                        maxWidth={maxWidth}
                        height={inboxBannerHeight}
                        marginX="center"
                        display="flex"
                        justifyContent="center"
                        flexDirection="row"
                    >
                        <Box
                            display="flex"
                            paddingX={screenPaddingX}
                            alignItems="center"
                            width={isInboxEntryTask ? contentStyles.contentMaxWidth : "full"}
                        >
                            <Box
                                color="grey-50"
                                fontSize="75"
                                fontStyle="truncate"
                                paddingRight={
                                    !navigation && platform !== "mobile" ? "0.5" : undefined
                                }
                                userSelect={platform !== "mobile" ? "text" : undefined}
                            >
                                {platform === "mobile"
                                    ? "Notification"
                                    : `Notification: ${entryDisplaySummaryText}`}
                            </Box>
                            {!navigation && platform !== "mobile" && (
                                <IconButton
                                    size="xs"
                                    description="Open in inbox"
                                    tooltipPlacement="bottom"
                                    // The inbox will show a loading shimmer when it opens. We don't need to also show
                                    // a loading indicator here.
                                    withoutLoadingIndicator
                                    pressErrorTitle="Couldn&#x2019;t open in inbox"
                                    onPress={async () => {
                                        // base64 encode the initial path to hide the fact that it's a URL.
                                        const textEncoder = new TextEncoder();

                                        const newSearchParams = new URLSearchParams(
                                            location.search,
                                        );
                                        newSearchParams.delete("inbox");

                                        const newLocation = convertPeekPathToSpacePath(
                                            {...location, search: newSearchParams.toString()},
                                            {routeLayout: "wide"},
                                        );

                                        const selectedSearchParam = encodeBase64(
                                            textEncoder.encode(createPath(newLocation ?? location)),
                                            "Rfc4648Url",
                                        );

                                        await rootNavigate(
                                            `/inbox/${space.id}?${
                                                entry.model.isArchived ? `tab=done&` : ""
                                            }selected=${selectedSearchParam}`,
                                        );
                                    }}
                                >
                                    <ArrowUpRight />
                                </IconButton>
                            )}
                            <Box minWidth="10" flexGrow="1" />
                            {navigation && platform !== "mobile" && (
                                <>
                                    <IconButton
                                        size="xs"
                                        description="Previous notification"
                                        keyboardShortcutHint="↑"
                                        isDisabled={!navigation.previousEntry}
                                        pressErrorTitle="Can&#x2019;t go to previous notification"
                                        onPress={async () => {
                                            if (!navigation.previousEntry) return;
                                            await navigation.selectEntry(navigation.previousEntry);
                                        }}
                                    >
                                        <CaretUp />
                                    </IconButton>
                                    <IconButton
                                        size="xs"
                                        description="Next notification"
                                        keyboardShortcutHint="↓"
                                        isDisabled={!navigation.nextEntry}
                                        pressErrorTitle="Can&#x2019;t go to next notification"
                                        onPress={async () => {
                                            if (!navigation.nextEntry) return;
                                            await navigation.selectEntry(navigation.nextEntry);
                                        }}
                                    >
                                        <CaretDown />
                                    </IconButton>
                                    {!withoutArchiveButton && <Spacer space="2.5" />}
                                </>
                            )}
                            {!withoutArchiveButton && (
                                <Button
                                    ref={doneButtonRef}
                                    variant={
                                        entry.model.isArchived ? "neutral-disabled" : "neutral"
                                    }
                                    data-testid={
                                        entry.model.isArchived
                                            ? "InboxBannerOutletContainerDoneButton:Archived"
                                            : "InboxBannerOutletContainerDoneButton:NotArchived"
                                    }
                                    height="6"
                                    paddingX="2"
                                    icon={<Check />}
                                    keyboardShortcutHint={
                                        !entry.model.isArchived
                                            ? renderKeyboardShortcutHint(clientInfo, "mod", "d")
                                            : undefined
                                    }
                                    pressErrorTitle="Can&#x2019;t mark as done"
                                    onPress={handleDoneButtonPress}
                                >
                                    Done
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Box>
                <InboxContextProvider entry={entry}>{children}</InboxContextProvider>
            </Box>
        </GlobalKeyDownEvent>
    );
}
