import {Plus} from "phosphor-react";
import {useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {isPromiseLike} from "~/shared/helpers/async/is_promise_like.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";

/**
 * A ghost row that acts as a button to create a new bot and can be used as a
 * placeholder in a list.
 */
export function BotCreateGhostRow({
    label,
    circleSize = "12",
    labelFontSize = "200",
    gap = "4",
    paddingX = "4",
    paddingY = "4",
    withoutBorder = false,
    onPress,
}: {
    label: string;
    circleSize?: Spacing;
    labelFontSize?: "75" | "100" | "200";
    gap?: Spacing;
    paddingX?: Spacing;
    paddingY?: Spacing;
    /**
     * Skip the dashed border around the row. Use when the row sits inside a list so it
     * lines up with the list's items like a placeholder instead of looking like a
     * separate button.
     */
    withoutBorder?: boolean;
    pressErrorTitle?: string;
    onPress: () => MaybePromise<void>;
}) {
    const [isPending, setIsPending] = useState(false);

    const {pressProps} = usePress({
        onPress: () => {
            if (isPending) return;

            const result = onPress?.();

            // If `onPress` returns a promise then don't allow another press until the promise
            // is resolved.
            if (isPromiseLike(result)) {
                setIsPending(true);
                void result.finally(() => setIsPending(false));
            }
        },
    });

    return (
        <FocusRing offset="border">
            <Box
                {...pressProps}
                tabIndex={0}
                display="flex"
                alignItems="center"
                gap={gap}
                paddingX={paddingX}
                paddingY={paddingY}
                borderRadius="2"
                color="grey-60"
                cursor="pointer"
                opacity={isPending ? "50" : undefined}
                style={
                    withoutBorder ? undefined : {border: `1px dashed ${colorSchemeVars["grey-10"]}`}
                }
            >
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    borderRadius="full"
                    flexShrink="0"
                    style={{
                        width: spacing[circleSize],
                        height: spacing[circleSize],
                        border: `1px dashed ${colorSchemeVars["grey-10"]}`,
                    }}
                >
                    <Plus size={spacing["5"]} color={colorSchemeVars["grey-60"]} />
                </Box>
                <Box fontSize={labelFontSize} fontStyle="semi-bold">
                    {label}
                </Box>
            </Box>
        </FocusRing>
    );
}
