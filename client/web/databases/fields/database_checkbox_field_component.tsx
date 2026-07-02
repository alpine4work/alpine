import {CheckSquare} from "phosphor-react";

import {
    type DatabaseGridViewCellContentProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {DatabaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";

const databaseCheckboxFieldProvider = new DatabaseCheckboxFieldProvider();

export const databaseCheckboxFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseCheckboxFieldProvider,
    {
        label: "Checkbox",
        Icon: CheckSquare,
        GridViewCellContent: function DatabaseCheckboxGridViewCellContent({
            ref,
            value,
            commitValue,
        }: DatabaseGridViewCellContentProps<"checkbox">) {
            const isChecked = value === true;

            const toggle = () => {
                commitValue(!isChecked);
            };

            return (
                <Box
                    ref={ref as React.Ref<HTMLDivElement>}
                    tabIndex={-1}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    height="full"
                    onClick={e => {
                        e.stopPropagation();
                        toggle();
                    }}
                    onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggle();
                        }
                    }}
                >
                    <CheckboxIcon isChecked={isChecked} />
                </Box>
            );
        },
        GridViewCellEditorOverlay: null,
        getConfigMenuActions: null,
    },
);
