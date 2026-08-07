import {Schema} from "~/shared/schema/schema.open_source.js";

export const MessagePosOrFilesSchema = Schema.integer.nullable().transform<number | "Files">({
    serialize: value => (value === "Files" ? null : value),
    deserialize: value => (value === null ? "Files" : value),
});
