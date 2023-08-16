import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * A CRDT register for a label string.
 */
export const LabelStringRegister = createCrdtRegister(LabelStringSchema);
