import {CheckCircle, Warning, X} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {spacing} from "~/shared/design/core/spacing.js";

export type InlineAlertVariant = "positive" | "negative";

/**
 * Renders an error message inline with some other content.
 */
export function InlineAlert({
    variant,
    title,
    onDismiss,
    children,
}: {
    /**
     * Which styles should we apply to the variant?
     */
    variant: InlineAlertVariant;

    /**
     * The title of the inline alert.
     *
     * Corresponds to the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    title: string;

    /**
     * Dismiss the error alert from the page.
     *
     * We require this prop since inline alerts are meant to be transient. For a
     * complete UX the user should be able to dismiss.
     */
    onDismiss: () => void;

    /**
     * The content of the inline alert.
     */
    children: ReactNode;
}) {
    const {color, IconComponent} = {
        positive: {
            color: "green-50",
            IconComponent: CheckCircle,
        } as const,
        negative: {
            color: "red-50",
            IconComponent: Warning,
        } as const,
    }[variant];

    return (
        <Box
            position="relative"
            backgroundColor="grey-0"
            padding="4"
            border={color}
            borderWidth="thick"
            borderRadius="1"
        >
            <Box position="absolute" top="1" right="1">
                <IconButton
                    size="xs"
                    description="Dismiss alert"
                    withoutTooltip={true}
                    onPress={onDismiss}
                >
                    <X />
                </IconButton>
            </Box>
            <Box display="flex" alignItems="center" gap="1.5" paddingBottom="2">
                <Box flexShrink="0" color={color}>
                    <IconComponent weight="fill" size={spacing["4"]} />
                </Box>
                <Box flexGrow="1" fontSize="200" fontStyle="semi-bold">
                    {title}
                </Box>
            </Box>
            {children}
        </Box>
    );
}
