import {DotsThreeVertical} from "phosphor-react";
import {Memo, Ref, forwardRef, useImperativeHandle, useMemo, useRef} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {ShareButton} from "~/client/web/navigation/share_button.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {backgroundFontSizePercentage} from "~/client/web/styles/styles.js";
import {taskQueryViewCustomizationBarDesktopMarginY} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientCollectionSubscription} from "~/client/web/tasks/core/task_client_collection_subscription.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {
    TaskCollectionViewDesktopHeaderName,
    TaskCollectionViewDesktopHeaderNameRef,
} from "~/client/web/tasks/internal/task_collection_view_desktop_header_name.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskQueryViewCustomizationBar} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {interFontAscender, interFontDescender} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskCollectionViewDesktopHeaderRef = {
    editName(): void;
    editColor(): void;
};

const TaskCollectionViewDesktopHeaderForwardRef = forwardRef(TaskCollectionViewDesktopHeader);
export {TaskCollectionViewDesktopHeaderForwardRef as TaskCollectionViewDesktopHeader};

function TaskCollectionViewDesktopHeader(
    {
        store,
        queryReferencesForUrlGrant,
        collectionId,
        collectionSubscription,
        shouldInitiallyFocusEditableCollectionName,
        affinityManager,
        createCollection,
        accessLevel,
        defaultOrderSentence,
        menuActions,
        filters,
        filterReferences,
        onFiltersChange,
        sorts,
        onSortsChange,
        onCopyLink,
    }: {
        store: TaskClientStore;
        queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
        collectionId: TaskCollectionId;
        // If `collectionSubscription` is null, that means we are creating a
        // new collection.
        collectionSubscription: TaskClientCollectionSubscription | null;
        shouldInitiallyFocusEditableCollectionName: boolean;
        affinityManager: TaskClientStoreSearchAffinityManager;
        createCollection: Memo<(name: string) => Promise<void>>;
        accessLevel: AccessLevel | null;
        defaultOrderSentence: string;
        menuActions: ReadonlyArray<ReadonlyArray<MenuAction>>;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
        onCopyLink: () => MaybePromise<void>;
    },
    ref: Ref<TaskCollectionViewDesktopHeaderRef>,
) {
    const context = useAppContext();
    const spacingScale = useSpacingScale();
    const {currentAccount} = useSpaceContext();

    const nameRef = useRef<TaskCollectionViewDesktopHeaderNameRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            editName: () => assertExists(nameRef.current).editName(),
            editColor: () => assertExists(nameRef.current).editColor(),
        }),
        [],
    );

    const collectionEntry = useStore(collectionSubscription?.collectionEntryStore ?? null);
    const collection = collectionEntry?.collection ?? null;

    // We want to baseline align our `fontSize="200"` collection name with our
    // centered `fontSize="75"` customization bar (filters and sort). Calculate
    // the offset for center aligned `fontSize="200"` using font metrics.
    const nameBaselineAlignmentMarginTop = useMemo(() => {
        const fontSize75 = fontSizesBySpacingScale["75"][spacingScale];

        const fontSize75Descender =
            fontSize75.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const fontSize75BottomHalfHeight = fontSize75Descender + fontSize75.fontSize / 2;

        const fontSize200 = fontSizesBySpacingScale["200"][spacingScale];

        const fontSize200Descender =
            fontSize200.fontSize *
            (backgroundFontSizePercentage - 1) *
            (interFontDescender / (interFontAscender + interFontDescender));

        const fontSize200BottomHalfHeight = fontSize200Descender + fontSize200.fontSize / 2;

        return -fontSize200BottomHalfHeight + fontSize75BottomHalfHeight;
    }, [spacingScale]);

    const accessPolicy: AccessPolicy = useMemo(
        () =>
            collection?.getAccessPolicy() ?? {
                accountGrantById: currentAccount
                    ? new Map([[currentAccount.id, {level: "Manage", generation: 0}]])
                    : emptyMap,
                defaultGrant: null,
                urlGrant: null,
            },
        [collection, currentAccount],
    );

    return (
        <Box
            flexShrink="0"
            minHeight={navigationBarHeight}
            display="flex"
            paddingX={screenPaddingX}
        >
            <Box
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                maxWidth="1/3"
                style={{marginTop: nameBaselineAlignmentMarginTop}}
                // Align the left edge of the desktop header name text with the left edge of
                // the "Name" column header.
                paddingLeft="1"
            >
                <TaskCollectionViewDesktopHeaderName
                    ref={nameRef}
                    accessLevel={accessLevel}
                    store={store}
                    affinityManager={affinityManager}
                    collectionId={collectionId}
                    isCreatingCollection={!collectionSubscription}
                    shouldInitiallyFocusEditableName={shouldInitiallyFocusEditableCollectionName}
                    collection={collection}
                    createCollection={createCollection}
                />
            </Box>
            <Box
                flexShrink="0"
                alignSelf="stretch"
                marginY="4"
                marginX={screenPaddingX}
                borderLeft="grey-5"
            />
            <Box
                flexGrow="1"
                style={{
                    paddingTop: taskQueryViewCustomizationBarDesktopMarginY,
                    paddingBottom: taskQueryViewCustomizationBarDesktopMarginY,
                }}
            >
                <TaskQueryViewCustomizationBar
                    store={store}
                    queryReferencesForUrlGrant={queryReferencesForUrlGrant}
                    shouldCollapseWhenFiltersAreEmpty={true}
                    defaultOrderSentence={defaultOrderSentence}
                    filters={filters}
                    filterReferences={filterReferences}
                    onFiltersChange={onFiltersChange}
                    sorts={sorts}
                    onSortsChange={onSortsChange}
                />
            </Box>
            <Box
                flexShrink="0"
                alignSelf="stretch"
                marginY="4"
                marginX={screenPaddingX}
                borderLeft="grey-5"
            />
            <Box
                flexShrink="0"
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                gap="2"
            >
                {currentAccount && (
                    <Box paddingRight="3">
                        <ShareButton
                            isReadOnly={!collectionSubscription}
                            entityNoun="task collection"
                            entityId={`TaskCollection:${collectionId}`}
                            accessPolicy={accessPolicy}
                            onAccessPolicyChange={(notification, accessPolicy) => {
                                store.commitTaskActionTransaction(
                                    context,
                                    [
                                        {
                                            type: "UpdateCollection",
                                            time: store.clock.now(),
                                            collectionId,
                                            collectionAction: {
                                                type: "UpdateAccessPolicy",
                                                accessPolicy,
                                            },
                                        },
                                    ],
                                    {
                                        // Collection access policy changes can't be undone.
                                        undoManager: null,
                                        affinityManager,
                                        // Include a notification if the user decided to configure one.
                                        updateAccessPolicyShareNotification:
                                            notification ?? undefined,
                                    },
                                );
                            }}
                            onCopyLink={onCopyLink}
                        />
                    </Box>
                )}
                <MenuButton actions={menuActions}>
                    <IconButton size="md" description="More" withoutTooltip>
                        <DotsThreeVertical />
                    </IconButton>
                </MenuButton>
            </Box>
        </Box>
    );
}
