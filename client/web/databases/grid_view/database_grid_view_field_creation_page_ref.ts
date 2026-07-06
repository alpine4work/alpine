/**
 * Imperative handle exposed by each page of the field creation popover. The field
 * name input lives in the header cell above the popover and keeps focus while the
 * user works through the pages, so the cell forwards its keyboard events to the
 * active page through this handle.
 */
export type DatabaseGridViewFieldCreationPageRef = {
    /** Arrow keys forwarded from the field name input. */
    onNameInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    /** Enter forwarded from the field name input. */
    onNameInputEnter: () => void;
};
