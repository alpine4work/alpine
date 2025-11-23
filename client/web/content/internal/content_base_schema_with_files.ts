import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {contentBaseProsemirrorSchemaSpec} from "~/shared/content/content_schema.js";
import {createContentFileProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

// Create a temporary schema we can use for constructing a `file` node we
// can copy.
export const ContentBaseProsemirrorSchemaWithFiles = new Lazy(
    () =>
        new ProsemirrorSchema({
            nodes: {
                ...contentBaseProsemirrorSchemaSpec.nodes,
                ...createContentFileProsemirrorNodeSpecs({withTable: true}),
            },
            marks: contentBaseProsemirrorSchemaSpec.marks,
        }),
);
