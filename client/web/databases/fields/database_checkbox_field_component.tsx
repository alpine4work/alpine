import {CheckSquare} from "phosphor-react";

import {
    type DatabaseGridViewCellContentProps,
    defineDatabaseFieldComponentProvider,
} from "~/client/web/databases/fields/database_field_component_provider.js";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {databaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";

export const databaseCheckboxFieldComponentProvider = defineDatabaseFieldComponentProvider(
    databaseCheckboxFieldProvider,
    {
        label: "Checkbox",
        Icon: CheckSquare,
        GridViewCellContent: function DatabaseCheckboxGridViewCellContent({
            ref,
            fieldName,
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
                    role="button"
                    aria-label={`${fieldName} cell`}
                    tabIndex={0}
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
