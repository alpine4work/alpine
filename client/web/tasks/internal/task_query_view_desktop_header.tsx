import {DotsThreeVertical} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useMemo, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {backgroundFontSizePercentage} from "~/client/web/styles/styles.js";
import {taskQueryViewCustomizationBarDesktopMarginY} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {
    TaskQueryViewCustomizationBar,
    TaskQueryViewCustomizationBarRef,
} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {
    TaskQueryViewDesktopHeaderName,
    TaskQueryViewDesktopHeaderNameRef,
} from "~/client/web/tasks/internal/task_query_view_desktop_header_name.js";
import {interFontAscender, interFontDescender} from "~/shared/design/core/font_metrics.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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
        queryReferencesForUrlGrant,
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
        queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
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
    const spacingScale = useSpacingScale();

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

    return (
        <Box minHeight={navigationBarHeight} display="flex" paddingX={screenPaddingX}>
            <Box
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                maxWidth="1/3"
                style={{marginTop: nameBaselineAlignmentMarginTop}}
                // Align the left edge of the desktop header name text with the left edge of
                // the "Name" column header.
                paddingLeft="5"
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
                    ref={customizationBarRef}
                    store={store}
                    queryReferencesForUrlGrant={queryReferencesForUrlGrant}
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
                <MenuButton actions={menuActions}>
                    <IconButton size="md" description="More" withoutTooltip>
                        <DotsThreeVertical />
                    </IconButton>
                </MenuButton>
            </Box>
        </Box>
    );
}
