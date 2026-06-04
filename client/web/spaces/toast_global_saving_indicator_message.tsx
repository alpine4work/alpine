import {Check, SpinnerGap} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";

export function ToastGlobalSavingIndicatorMessage({
    savingPromise,
}: {
    savingPromise: Promise<unknown>;
}) {
    const savingState = usePromise(savingPromise);

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <Box marginLeft="-0.5">
                {savingState.isPending ? (
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing["3"]}
                        color={colorSchemeVars["grey-70"]}
                    />
                ) : (
                    <Check size={spacing["3"]} color={colorSchemeVars["grey-70"]} />
                )}
            </Box>
            <Box>
                {savingState.isPending ? "Saving" : "Saved"}. Your work is saved automatically.
            </Box>
        </Box>
    );
}
