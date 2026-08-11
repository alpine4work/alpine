import {Mapping, StepMap} from "prosemirror-transform";
import {Schema} from "~/shared/schema/schema.js";

declare module "prosemirror-transform" {
    interface StepMap {
        // We know this exists but `prosemirror-transform` marks it as internal:
        // https://github.com/ProseMirror/prosemirror-transform/blob/3edf794b2b23766bd388145f6dba579154be03eb/src/map.ts#L77-L80
        readonly ranges: ReadonlyArray<number>;
        readonly inverted: boolean;
    }

    interface Mapping {
        // We know this exists but `prosemirror-transform` marks it as internal:
        // https://github.com/ProseMirror/prosemirror-transform/blob/3edf794b2b23766bd388145f6dba579154be03eb/src/map.ts#L176-L177
        readonly mirror?: Array<number>;
    }
}

export const ProsemirrorStepMapSchema = Schema.object({
    ranges: Schema.array(Schema.integer),
    inverted: Schema.boolean,
}).transform<StepMap>({
    serialize: stepMap => ({ranges: stepMap.ranges, inverted: stepMap.inverted}),
    deserialize: stepMap => new StepMap(stepMap.ranges, stepMap.inverted),
});

export const ProsemirrorMappingSchema = Schema.object({
    maps: Schema.array(ProsemirrorStepMapSchema),
    mirror: Schema.array(Schema.integer).optional(),
    from: Schema.integer.optional(),
    to: Schema.integer.optional(),
}).transform<Mapping>({
    serialize: mapping => ({
        maps: mapping.maps,
        mirror: mapping.mirror,
        from: mapping.from !== 0 ? mapping.from : undefined,
        to: mapping.to !== mapping.maps.length ? mapping.to : undefined,
    }),
    deserialize: mapping =>
        new Mapping(mapping.maps, mapping.mirror?.slice(), mapping.from, mapping.to),
});
