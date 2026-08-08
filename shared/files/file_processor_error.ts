import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export type FileProcessorError = SchemaType<typeof FileProcessorErrorSchema>;

// Not a full `ErrorSchema` since we store this in the database. Storing properties
// like the stack trace, `original` trace, and `cause` don't make sense for a
// persisted error.
export const FileProcessorErrorSchema = Schema.union({
    Unknown: Schema.object({type: Schema.value("Unknown")}),
    PasswordProtected: Schema.object({type: Schema.value("PasswordProtected")}),
});
