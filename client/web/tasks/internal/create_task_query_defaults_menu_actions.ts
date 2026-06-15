import {MenuAction} from "~/client/web/design/menu.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {TaskQueryDefaults} from "~/shared/tasks/task_query_defaults.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {TaskQuerySort, serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function createTaskQueryDefaultsMenuActions({
    noun,
    accessLevel,
    defaults,
    filters,
    sorts,
    onResetToDefaults,
    onSaveDefaults,
}: {
    noun: string;
    accessLevel: AccessLevel | null;
    defaults: TaskQueryDefaults;
    filters: ReadonlyArray<TaskQueryFilter>;
    sorts: ReadonlyArray<TaskQuerySort>;
    onResetToDefaults: () => void;
    onSaveDefaults: () => void;
}) {
    const hasDefaultFilters =
        serializeTaskQueryFiltersSearchParam(filters) ===
        serializeTaskQueryFiltersSearchParam(defaults.filters);

    const hasDefaultSorts =
        serializeTaskQuerySortsSearchParam(sorts) ===
        serializeTaskQuerySortsSearchParam(defaults.sorts);

    const hasAllDefaults = hasDefaultFilters && hasDefaultSorts;

    const labels: Array<string> = [];
    if (!hasDefaultFilters) labels.push("filters");
    if (!hasDefaultSorts) labels.push("sorts");

    if (labels.length === 0) {
        if (defaults.filters.length > 0) labels.push("filters");
        if (defaults.sorts.length > 0) labels.push("sorts");
    }

    if (labels.length === 0) labels.push("filters");

    const label = labels.join("/");

    const hasManageAccessLevel = hasAccessLevel(accessLevel, "Manage");

    const menuActions: Array<MenuAction> = [
        {
            label: `Reset to default ${label}`,
            onPress: () => {
                if (hasAllDefaults) return;
                onResetToDefaults();
            },
        },
    ];

    if (hasManageAccessLevel) {
        menuActions.push({
            label: `Save as default ${label}`,
            onPress: () => {
                if (hasAllDefaults) return;
                onSaveDefaults();
            },
        });
    }

    const menuExtraBottomMessage = !hasAllDefaults
        ? `* The current ${label} are only visible to you.` +
          (hasManageAccessLevel
              ? ` Save them as default so everyone who opens the ${noun} sees them.`
              : "")
        : null;

    return {
        hasAllDefaults,
        menuActions,
        menuExtraBottomMessage,
    };
}
