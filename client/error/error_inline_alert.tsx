import {Warning, X} from "phosphor-react";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {ErrorDisplayMessageRenderer} from "~/client/error/error_display_message_renderer";
import {spacing} from "~/shared/design/spacing";

/**
 * Renders an error message inline with some other content.
 */
export function ErrorInlineAlert({
    title,
    error,
    onDismiss,
}: {
    /**
     * The title of the inline alert.
     *
     * Corresponds to the "what happened" part of an error message according to
     * [Adobe Spectrum's][1] error content guidelines.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    title: string;

    /**
     * The error we are rendering in an inline alert. We will render the
     * `ErrorDisplayMessage` from this error.
     */
    error: unknown;

    /**
     * Dismiss the error alert from the page.
     */
    onDismiss: () => void;
}) {
    return (
        <Box
            position="relative"
            backgroundColor="grey-0"
            padding="4"
            border="red-40"
            borderWidth="thick"
            borderRadius="base"
        >
            <Box position="absolute" top="1.5" right="1.5">
                <IconButton
                    size="small"
                    description="Dismiss alert"
                    onPress={onDismiss}
                    withoutTooltip={true}
                >
                    <X />
                </IconButton>
            </Box>
            <Box display="flex" gap="1.5" paddingBottom="2">
                <Box
                    flexShrink="0"
                    color="red-40"
                    height="6"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Warning weight="fill" size={spacing["4"]} />
                </Box>
                <Box flexGrow="1" typographySize="body" typographyStyle="primaryMedium">
                    {title}
                </Box>
            </Box>
            <ErrorDisplayMessageRenderer error={error} />
        </Box>
    );
}
