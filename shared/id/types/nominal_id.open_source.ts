import type {ChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {RandomId} from "~/shared/id/id.open_source.js";

/**
 * Creates a new ID type with the provided name. TypeScript will error if you try
 * to assign two nominal IDs with different types to each other.
 *
 * There is nothing at runtime to validate whether an ID is of a certain type. It
 * is all a type system level safety mechanism.
 *
 * By being a type system only feature of IDs we keep our bundle size small. If
 * there was some runtime check for nominal IDs we'd either need to ship a manifest
 * of all our ID types to the client or we'd need to generate code like
 * `Schema.spaceId` and `generateSpaceId()` for every ID type.
 */
export type NominalRandomIdType<Type extends string> = RandomId & {
    readonly [type]: Type;
};
export type NominalChronologicalIdType<Type extends string> = ChronologicalId & {
    readonly [type]: Type;
};
declare const type: unique symbol;
