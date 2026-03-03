export const textInputTypes: ReadonlySet<string> = new Set([
    "text",
    "password",
    "number",
    "email",
    "tel",
    "url",
    "search",
    "date",
    "datetime",
    "datetime-local",
    "time",
    "month",
    "week",
]);

/**
 * Is the provided element one the user can input text into when focused? This
 * means letters or arrow keys and other keyboard shortcuts will go towards text
 * editing when this element is focused and shouldn't be used for keyboard
 * shortcuts.
 *
 * Supports `null` so it can be used with `document.activeElement`. Supports
 * `EventTarget` so it can be used with `event.target`.
 */
export function isTextInputElement(element: EventTarget | null): element is HTMLElement {
    return (
        element !== null &&
        ((element instanceof HTMLElement && element.isContentEditable) ||
            (element instanceof HTMLTextAreaElement && !element.readOnly && !element.disabled) ||
            (element instanceof HTMLInputElement &&
                textInputTypes.has(element.type) &&
                !element.readOnly &&
                !element.disabled))
    );
}
