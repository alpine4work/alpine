import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {ModelClass} from "~/shared/models/model";
import {Schema, UnionSchema} from "~/shared/schema/schema";

/**
 * Create a union schema from multiple model classes.
 */
export function createModelUnionSchema<Config extends {[type: string]: ModelClass<any>}>(
    config: Config,
): Schema<InstanceType<Config[keyof Config]>> {
    const typeByModelClass = new Map<ModelClass<any>, string>();

    for (const [type, modelClass] of Object.entries(config)) {
        assert(!typeByModelClass.has(modelClass));
        typeByModelClass.set(modelClass, type);
    }

    return UnionSchema._new(
        mapObjectValues(config, modelClass => modelClass.schema()),
        {
            getType: model =>
                assertExists(
                    typeByModelClass.get(model.constructor as ModelClass<any>),
                    "Model must be directly instantiated from a class in the model union schema, no inheritance allowed",
                ),
        },
    ) as Schema<InstanceType<Config[keyof Config]>>;
}
