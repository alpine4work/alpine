import {DotsThreeVertical} from "phosphor-react";
import {Ref, RefObject, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {ContextMenuActions} from "~/client/web/design/context_menu.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {NavigationBarShareButtonProps} from "~/client/web/navigation/navigation_bar_types.js";
import {ShareButton} from "~/client/web/navigation/share_button.js";
import {taskQueryViewCustomizationBarDesktopMarginY} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {TaskQueryNormalizedFiltersInitialFieldsModel} from "~/client/web/tasks/core/task_query_normalized_filters_initial_fields_model.js";
import {
    TaskProjectDetailViewNavigationBarTitle,
    TaskProjectDetailViewNavigationBarTitleRef,
} from "~/client/web/tasks/internal/task_detail_view_navigation_bar_title.js";
import {TaskQueryReferencesForUrlGrantFilterEditor} from "~/client/web/tasks/internal/task_query_references_for_url_grant_filter_editor.js";
import {TaskQueryViewCustomizationBar} from "~/client/web/tasks/internal/task_query_view_customization_bar.js";
import {TaskStatusButton} from "~/client/web/tasks/internal/task_status_button.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {TaskTitleUpdateModel} from "~/shared/tasks/title/task_title.js";

export type TaskProjectDetailViewDesktopHeaderRef = {
    editTitle(): void;
};

const TaskProjectDetailViewDesktopHeaderForwardRef = forwardRef(TaskProjectDetailViewDesktopHeader);
export {TaskProjectDetailViewDesktopHeaderForwardRef as TaskProjectDetailViewDesktopHeader};

function TaskProjectDetailViewDesktopHeader(
    {
        store,
        taskSubscription,
        initialFields,
        isReadOnly,
        onTitleChange,
        statusButtonRef,
        commitActionTransaction,
        menuActions,
        shareButton,
        queryReferencesForUrlGrant,
        defaultOrderSentence,
        filters,
        filterReferences,
        onFiltersChange,
        sorts,
        onSortsChange,
    }: {
        store: TaskClientStore;
        taskSubscription: TaskClientTaskSubscription | null;
        initialFields: TaskQueryNormalizedFiltersInitialFieldsModel;
        isReadOnly: boolean;
        onTitleChange: (titleUpdate: TaskTitleUpdateModel) => void;
        statusButtonRef: RefObject<HTMLElement | null>;
        commitActionTransaction: (
            getActions: (taskId: TaskId) => ReadonlyArray<TaskActionModel>,
        ) => void;
        menuActions: ReadonlyArray<ReadonlyArray<MenuAction>>;
        shareButton: NavigationBarShareButtonProps | undefined;
        queryReferencesForUrlGrant: TaskQueryReferencesForUrlGrantFilterEditor | null;
        defaultOrderSentence: string;
        filters: ReadonlyArray<TaskQueryFilter>;
        filterReferences: TaskQueryFilterReferences;
        onFiltersChange: (
            filters: ReadonlyArray<TaskQueryFilter>,
            options?: {mergeFilterReferences?: TaskQueryFilterReferences},
        ) => void;
        sorts: ReadonlyArray<TaskQuerySort>;
        onSortsChange: (sorts: ReadonlyArray<TaskQuerySort>) => void;
    },
    ref: Ref<TaskProjectDetailViewDesktopHeaderRef>,
) {
    const titleRef = useRef<TaskProjectDetailViewNavigationBarTitleRef>(null);
    const task = useStore(taskSubscription?.taskEntryStore ?? null)?.task ?? null;

    useImperativeHandle(
        ref,
        () => ({
            editTitle: () => assertExists(titleRef.current).editTitle(),
        }),
        [],
    );

    return (
        <ContextMenuActions actions={menuActions}>
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
                    gap="3"
                    maxWidth="2/5"
                >
                    <TaskStatusButton
                        ref={statusButtonRef}
                        size="6"
                        store={store}
                        task={task}
                        initialFields={initialFields}
                        isDisabled={isReadOnly}
                        commitActionTransaction={commitActionTransaction}
                    />
                    <Box
                        overflow="hidden"
                        // Same styles that would be on a title in `<NavigationBarContent>` since that's
                        // where `<TaskProjectDetailViewNavigationBarTitle>` thinks it's rendered.
                        fontSize="200"
                        fontStyle="semi-bold"
                        userSelect="text"
                        paddingLeft="1"
                        marginLeft="-1"
                        style={{
                            // Render contextual alternate glyphs. User text may be rendered here. Helpful
                            // for consistency if the user types anything like 2x2 or an @ mention.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                    >
                        <TaskProjectDetailViewNavigationBarTitle
                            ref={titleRef}
                            taskSubscription={taskSubscription}
                            isReadOnly={isReadOnly}
                            onTitleChange={onTitleChange}
                        />
                    </Box>
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
                    {shareButton && (
                        <Box paddingRight="3">
                            <ShareButton
                                entityNoun={shareButton.entityNoun}
                                entityId={shareButton.entityId}
                                accessLevelText={shareButton.accessLevelText}
                                accessPolicy={shareButton.accessPolicy}
                                inherited={shareButton.inherited}
                                onAccessPolicyChange={shareButton.onAccessPolicyChange}
                                isReadOnly={shareButton.isReadOnly}
                                withoutEditAccessLevel={shareButton.withoutEditAccessLevel}
                                withHiddenCommentAccessLevel={
                                    shareButton.withHiddenCommentAccessLevel
                                }
                                onCopyLink={shareButton.onCopyLink}
                                activationHint={shareButton.activationHint}
                                onActivationHintHide={shareButton.onActivationHintHide}
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
        </ContextMenuActions>
    );
}
