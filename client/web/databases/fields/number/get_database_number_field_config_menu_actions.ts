import type {DatabaseFieldConfigMenuActionsArgs} from "~/client/web/databases/fields/database_grid_view_cell_props.js";
import type {MenuActions} from "~/client/web/design/menu.js";

const decimalPlacesOptions: ReadonlyArray<{label: string; value: number | null}> = [
    {label: "Default", value: null},
    {label: "0", value: 0},
    {label: "1", value: 1},
    {label: "2", value: 2},
    {label: "3", value: 3},
    {label: "4", value: 4},
    {label: "5", value: 5},
    {label: "6", value: 6},
];

export function getDatabaseNumberFieldConfigMenuActions({
    config,
    onCommit,
}: DatabaseFieldConfigMenuActionsArgs<"number">): MenuActions {
    return [
        {
            hasChildren: true,
            key: "decimal-places",
            label: "Decimal places",
            actions: decimalPlacesOptions.map(option => ({
                label: option.label,
                isSelected: option.value === config.decimalPlaces,
                onPress: () => {
                    onCommit({type: "number", decimalPlaces: option.value});
                },
            })),
        },
    ];
}
