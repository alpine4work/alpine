import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const InboxEntryStatusSchema = Schema.enum(["New", "Done"]);

export type InboxEntryStatus = SchemaType<typeof InboxEntryStatusSchema>;
