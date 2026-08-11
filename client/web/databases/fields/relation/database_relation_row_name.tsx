import {sprinkles} from "~/client/web/styles/styles.js";

/**
 * Renders a linked record's name, falling back to a muted "Untitled" when the
 * record has no meaningful name (`null`, empty, or whitespace-only). Preserves the
 * name's whitespace with `white-space: pre` so names aren't silently collapsed.
 */
export function DatabaseRelationRowName({name}: {name: string | null}) {
    if (name == null || name.trim() === "") {
        return <span className={sprinkles({color: "grey-50"})}>Untitled</span>;
    }
    return <span style={{whiteSpace: "pre"}}>{name}</span>;
}
