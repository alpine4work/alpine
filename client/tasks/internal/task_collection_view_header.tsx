import {DotsThreeVertical, Lock, LockOpen} from "phosphor-react";
import {Memo, useMemo, useRef} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {
    desktopNavigationBarHeightRem,
    mobileNavigationBarHeightRem,
    navigationBarHeight,
} from "~/client/design/navigation_bar.js";
import {ShareButton} from "~/client/design/share_button.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskCollectionViewHeaderName,
    TaskCollectionViewHeaderNameRef,
} from "~/client/tasks/internal/task_collection_view_header_name.js";
import {taskQueryFilterEditorHeight} from "~/client/tasks/internal/task_query_filter_editor.js";
import {TaskQueryViewCustomizationBar} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/task_client_store.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {
    backgroundFontSizePercentage,
    fontSizesByPlatform,
    interFontDescenderPercentage,
} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function TaskCollectionViewHeader({
    withMobileLayout,
    store,
    collectionId,
    collectionSubscription,
    affinityManager,
    createCollection,
    isReadOnly,
    filters,
    filterReferences,
    onFiltersChange,
    sorts,
    onSortsChange,
}: {
    withMobileLayout: boolean;
    store: TaskClientStore;
    collectionId: TaskCollectionId;
    // If `collectionSubscription` is null, that means we are creating a
    // new collection.
    collectionSubscription: TaskClientCollectionSubscription | null;
    affinityManager: TaskClientStoreSearchAffinityManager;
    createCollection: Memo<(name: string) => Promise<void>>;
    isReadOnly: boolean;
    filters: ReadonlyArray<TaskQueryFilter>;
    filterReferences: TaskQueryFilterReferences;
    onFiltersChange: (
        filters: ReadonlyArray<TaskQueryFilter>,
        options?: {mergeFilterReferences?: TaskQueryFilterReferences},
    ) => void;
    sorts: ReadonlyArray<TaskQuerySort>;
    onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
}) {
    const isMobile = useIsMobile();
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContext();
    const navigate = useNavigate();

    const nameRef = useRef<TaskCollectionViewHeaderNameRef>(null);

    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection ?? null;

    const menuActions: Array<ReadonlyArray<MenuAction>> = [];

    menuActions.push([
        {
            label: "Copy link",
            pressErrorTitle: "Couldn’t copy collection link",
            onPress: async () => {
                const url = new URL(
                    `/s/${space.id}/tasks/collections/${collectionId}`,
                    window.location.href,
                );
                await writeTextToClipboard(url.toString());
            },
        },
    ]);

    if (!isReadOnly) {
        // Even though you can edit the collection name by double clicking and the
        // color by clicking on the dot, we still include menu items since these
        // interactions aren't necessarily obvious.
        //
        // Also, the color and name are not focusable. So the only way to edit
        // name/color via keyboard are these menu items.
        menuActions.push([
            {
                label: "Edit name",
                onPress: () => assertExists(nameRef.current).editName(),
            },
            {
                label: "Edit color",
                onPress: () => assertExists(nameRef.current).editColor(),
            },
        ]);

        const isPrivate = !collection?.getAccessPolicy().defaultGrant;

        // TODO(calebmer): Collections support more involved permission rules than just
        // public/private. Eventually I want a full sharing dialog (like in Google
        // Docs) but I want that sharing dialog to work across all stuff in the space.
        // Including docs and channels.
        menuActions.push([
            {
                label: isPrivate ? "Make public" : "Make private",
                icon: isPrivate ? <LockOpen /> : <Lock />,
                iconPlacement: "end",
                onPress: () => {
                    if (isPrivate) {
                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateCollection",
                                    time: store.clock.now(),
                                    collectionId,
                                    collectionAction: {
                                        type: "UpdateAccessPolicy",
                                        accessPolicy: {
                                            accountGrantById: new Map([
                                                [currentAccount.id, {level: "Manage"}],
                                            ]),
                                            defaultGrant: {type: "Space", level: "Manage"},
                                        },
                                    },
                                },
                            ],
                            // Collection changes can't be undone.
                            {undoManager: null, affinityManager},
                        );
                    } else {
                        store.commitTaskActionTransaction(
                            context,
                            [
                                {
                                    type: "UpdateCollection",
                                    time: store.clock.now(),
                                    collectionId,
                                    collectionAction: {
                                        type: "UpdateAccessPolicy",
                                        accessPolicy: {
                                            accountGrantById: new Map([
                                                [currentAccount.id, {level: "Manage"}],
                                            ]),
                                            defaultGrant: null,
                                        },
                                    },
                                },
                            ],
                            // Collection changes can't be undone.
                            {undoManager: null, affinityManager},
                        );
                    }
                },
            },
        ]);

        menuActions.push([
            {
                label: "Delete",
                onPress: () => {
                    store.commitTaskActionTransaction(
                        context,
                        [
                            {
                                type: "UpdateCollection",
                                time: store.clock.now(),
                                collectionId,
                                collectionAction: {type: "Delete"},
                            },
                        ],
                        // Collection changes can't be undone.
                        {undoManager: null, affinityManager},
                    );

                    void navigate(-1);
                },
            },
        ]);
    }

    const customizationBarMarginY = useMemo(() => {
        return `${
            ((isMobile ? mobileNavigationBarHeightRem : desktopNavigationBarHeightRem) -
                parseRemLengthNumber(spacing[taskQueryFilterEditorHeight])) /
            2
        }rem`;
    }, [isMobile]);

    // We want to baseline align our `fontSize="200"` collection name with our
    // centered `fontSize="75"` customization bar (filters and sort). Calculate
    // the offset for center aligned `fontSize="200"` using font metrics.
    const nameBaselineAlignmentMarginTop = useMemo(() => {
        const fontSize75 = fontSizesByPlatform["75"][isMobile ? "mobile" : "desktop"];

        const fontSize75Descender =
            fontSize75.fontSize * (backgroundFontSizePercentage - 1) * interFontDescenderPercentage;

        const fontSize75BottomHalfHeight = fontSize75Descender + fontSize75.fontSize / 2;

        const fontSize200 = fontSizesByPlatform["200"][isMobile ? "mobile" : "desktop"];

        const fontSize200Descender =
            fontSize200.fontSize *
            (backgroundFontSizePercentage - 1) *
            interFontDescenderPercentage;

        const fontSize200BottomHalfHeight = fontSize200Descender + fontSize200.fontSize / 2;

        return -fontSize200BottomHalfHeight + fontSize75BottomHalfHeight;
    }, [isMobile]);

    return (
        <Box minHeight={navigationBarHeight} display="flex" paddingX={taskRowViewPaddingX}>
            <Box
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                maxWidth="1/3"
                style={{marginTop: nameBaselineAlignmentMarginTop}}
            >
                <TaskCollectionViewHeaderName
                    ref={nameRef}
                    isReadOnly={isReadOnly}
                    store={store}
                    affinityManager={affinityManager}
                    collectionId={collectionId}
                    isCreatingCollection={!collectionSubscription}
                    collection={collection}
                    createCollection={createCollection}
                />
            </Box>
            <Box
                flexShrink="0"
                alignSelf="stretch"
                marginY="4"
                marginX={taskRowViewPaddingX}
                borderLeft="grey-5"
            />
            <Box
                flexGrow="1"
                style={{
                    paddingTop: customizationBarMarginY,
                    paddingBottom: customizationBarMarginY,
                }}
            >
                {!withMobileLayout && (
                    // TODO(calebmer): Create an interface for adding filters/sorts in a mobile
                    // layout. We can't use our pill design since we don't have the
                    // horizontal space.
                    <TaskQueryViewCustomizationBar
                        store={store}
                        shouldCollapseWhenFiltersAreEmpty={true}
                        defaultOrderSentence={
                            filters.length > 0
                                ? "When filtered, tasks are ordered by created date."
                                : "You can order tasks manually by dragging them."
                        }
                        filters={filters}
                        filterReferences={filterReferences}
                        onFiltersChange={onFiltersChange}
                        sorts={sorts}
                        onSortsChange={onSortsChange}
                    />
                )}
            </Box>
            <Box
                flexShrink="0"
                alignSelf="stretch"
                marginY="4"
                marginX={taskRowViewPaddingX}
                borderLeft="grey-5"
            />
            <Box
                flexShrink="0"
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                gap="2"
            >
                <Box paddingRight="3">
                    <ShareButton />
                </Box>
                <MenuButton actions={menuActions}>
                    <IconButton size="sm" description="More" withoutTooltip>
                        <DotsThreeVertical />
                    </IconButton>
                </MenuButton>
            </Box>
        </Box>
    );
}
