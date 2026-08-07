import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export const InboxEntryStatusSchema = Schema.enum(["New", "Done"]);

export type InboxEntryStatus = SchemaType<typeof InboxEntryStatusSchema>;
