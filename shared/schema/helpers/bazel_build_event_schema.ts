// In `shared/schema/helpers` since we don't have a better place for this type
// that's shared across `//admin/dev` and `//app:app_wrapper`. Should we create a
// `shared/dev` package?

import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type BazelBuildEvent = SchemaType<typeof BazelBuildEventSchema>;

export const BazelBuildEventSchema = Schema.union({
    BuildStart: Schema.object({
        type: Schema.value("BuildStart"),
        targets: Schema.array(Schema.string),
    }),
    BuildFinish: Schema.object({
        type: Schema.value("BuildFinish"),
        targets: Schema.array(Schema.string),
        durationMs: Schema.float,
        hasFailed: Schema.boolean,
    }),
});
