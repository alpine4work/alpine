import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {InlineAlert} from "~/client/web/design/inline_alert.js";

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
        <InlineAlert variant="negative" title={title} onDismiss={onDismiss}>
            <ErrorDisplayMessageRenderer error={error} />
        </InlineAlert>
    );
}
