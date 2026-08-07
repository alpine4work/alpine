import {DotsThreeVertical} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useAlignFontBaselines} from "~/client/web/design/use_align_font_baselines.js";
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
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
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

    return (
        <Box minHeight={navigationBarHeight} display="flex" paddingX={screenPaddingX}>
            <Box
                height={navigationBarHeight}
                display="flex"
                alignItems="center"
                maxWidth="1/3"
                style={{marginTop: useAlignFontBaselines("200", "75")}}
                // Align the left edge of the desktop header name text with the left edge of the
                // "Name" column header.
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
