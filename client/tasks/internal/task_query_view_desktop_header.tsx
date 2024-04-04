import {DotsThreeVertical} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useMemo, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction, MenuButton} from "~/client/design/menu_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
    desktopTaskQueryViewCustomizationBarMarginY,
} from "~/client/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewDesktopHeaderName,
    TaskQueryViewDesktopHeaderNameRef,
} from "~/client/tasks/internal/task_query_view_desktop_header_name.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {taskRowViewPaddingX} from "~/client/tasks/task_row_shared_styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    backgroundFontSizePercentage,
    fontSizesByPlatform,
    interFontDescenderPercentage,
} from "~/shared/styles/styles.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export type TaskQueryViewDesktopHeaderRef = {
    editName(): void;
    openFirstCollectionsFilterOperationValue(): void;
};

const TaskQueryViewDesktopHeaderForwardRef = forwardRef(TaskQueryViewDesktopHeader);
export {TaskQueryViewDesktopHeaderForwardRef as TaskQueryViewDesktopHeader};

function TaskQueryViewDesktopHeader(
    {
        store,
        menuActions,
        defaultOrderSentence,
        name,
        onNameChange,
        filters,
        filterReferences,
        onFiltersChange,
        sorts,
        onSortsChange,
    }: {
        store: TaskClientStore;
        menuActions: ReadonlyArray<ReadonlyArray<MenuAction>>;
        defaultOrderSentence: string;
        name: string;
        onNameChange: (name: string) => void;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    },
    ref: Ref<TaskQueryViewDesktopHeaderRef>,
) {
    const isMobile = useIsMobile();

    const nameRef = useRef<TaskQueryViewDesktopHeaderNameRef>(null);
    const customizationBarRef = useRef<TaskQueryViewCustomizationBarRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            editName: () => assertExists(nameRef.current).editName(),
            openFirstCollectionsFilterOperationValue: () =>
                assertExists(
                    customizationBarRef.current,
                ).openFirstCollectionsFilterOperationValue(),
        }),
        [],
    );

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
                <TaskQueryViewDesktopHeaderName
                    ref={nameRef}
                    name={name}
                    onNameChange={onNameChange}
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
                    ref={customizationBarRef}
                    store={store}
                    shouldCollapseWhenFiltersAreEmpty={false}
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
                <MenuButton actions={menuActions}>
                    <IconButton size="sm" description="More" withoutTooltip>
                        <DotsThreeVertical />
                    </IconButton>
                </MenuButton>
            </Box>
        </Box>
    );
}
