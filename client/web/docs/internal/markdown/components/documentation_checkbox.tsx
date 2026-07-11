import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";

/** A task-list checkbox, rendered read-only and as `[x]`/`[ ]` in markdown. */
export const DocumentationCheckbox = documentationComponent({
    react: ({type, checked}: {type?: string; checked?: boolean}) => (
        <input type={type} checked={checked} readOnly />
    ),
    markdown: props => (props.checked === true ? "[x] " : "[ ] "),
});
