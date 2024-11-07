import {Check} from "phosphor-react";
import {Box} from "~/client/design/box.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";

// TODO(calebmer): We should probably use a general system-wide checkbox here
// someday instead of a checkbox specifically for the task system.
export function TaskCheckbox({isChecked}: {isChecked: boolean}) {
    return (
        <Box
            width="3"
            height="3"
            border={!isChecked ? "grey-20" : undefined}
            borderRadius="0.5"
            backgroundColor={!isChecked ? "grey-0" : "grey-90"}
            display="flex"
            justifyContent="center"
            alignItems="center"
        >
            {isChecked && (
                <Check
                    color={colorSchemeVars["grey-0"]}
                    weight="bold"
                    size={addRemLengths(spacing["2"], spacing["0.5"])}
                />
            )}
        </Box>
    );
}
