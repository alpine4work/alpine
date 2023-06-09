import {Check} from "phosphor-react";
import {Box} from "~/client/design/box";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/styles";

export function TaskCheckbox({isChecked}: {isChecked: boolean}) {
    return (
        <Box
            width="3"
            height="3"
            border={!isChecked ? "grey-20" : undefined}
            borderRadius="sm"
            backgroundColor={!isChecked ? "grey-0" : {light: "grey-80", dark: "grey-90"}}
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
