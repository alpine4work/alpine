import {DotsThreeVertical} from "phosphor-react";
import {Memo, Ref, forwardRef, useImperativeHandle, useMemo, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {ShareButton} from "~/client/design/share_button.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    TaskCollectionViewDesktopHeaderName,
    TaskCollectionViewDesktopHeaderNameRef,
} from "~/client/tasks/internal/task_collection_view_desktop_header_name.js";
import {
    TaskQueryViewCustomizationBar,
    desktopTaskQueryViewCustomizationBarMarginY,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
} from "~/client/tasks/task_client_store.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
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

export type TaskCollectionViewDesktopHeaderRef = {
    editName(): void;
    editColor(): void;
};

const TaskCollectionViewDesktopHeaderForwardRef = forwardRef(TaskCollectionViewDesktopHeader);
export {TaskCollectionViewDesktopHeaderForwardRef as TaskCollectionViewDesktopHeader};

function TaskCollectionViewDesktopHeader(
    {
        store,
        collectionId,
        collectionSubscription,
        affinityManager,
        createCollection,
        isReadOnly,
        defaultOrderSentence,
        menuActions,
        filters,
        filterReferences,
        onFiltersChange,
        sorts,
        onSortsChange,
    }: {
        store: TaskClientStore;
        collectionId: TaskCollectionId;
        // If `collectionSubscription` is null, that means we are creating a
        // new collection.
        collectionSubscription: TaskClientCollectionSubscription | null;
        affinityManager: TaskClientStoreSearchAffinityManager;
        createCollection: Memo<(name: string) => Promise<void>>;
        isReadOnly: boolean;
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
    },
    ref: Ref<TaskCollectionViewDesktopHeaderRef>,
) {
    const isMobile = useIsMobile();

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
                <TaskCollectionViewDesktopHeaderName
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
                    paddingTop: desktopTaskQueryViewCustomizationBarMarginY,
                    paddingBottom: desktopTaskQueryViewCustomizationBarMarginY,
                }}
            >
                <TaskQueryViewCustomizationBar
                    store={store}
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
