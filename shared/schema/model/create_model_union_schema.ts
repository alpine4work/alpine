import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {Schema, UnionSchema} from "~/shared/schema/schema.js";

/**
 * Create a union schema from multiple model classes.
 *
 * The optional `typeKey` argument overrides the property used to discriminate
 * variants on the wire. The default is `"type"`, but pass a unique key (e.g.
 * `"_modelType"`) when the wrapped model classes have their own underlying
 * discriminated unions also keyed on `"type"` — otherwise the outer wrapper will
 * overwrite the inner discriminator on serialize and the inner union will fail
 * with `"Unknown type"` on deserialize.
 */
export function createModelUnionSchema<
    Config extends {
        [type: string]: {
            new (...args: any): any;
            schema: Schema<any> | (() => Schema<any>);
        };
    },
>(config: Config, {typeKey}: {typeKey?: string} = {}): Schema<InstanceType<Config[keyof Config]>> {
    const typeByModelClass = new Map<
        {
            new (...args: any): any;
            schema: Schema<any> | (() => Schema<any>);
        },
        string
    >();

    for (const [type, modelClass] of Object.entries(config)) {
        assert(!typeByModelClass.has(modelClass));
        typeByModelClass.set(modelClass, type);
    }

    return UnionSchema._new(
        mapObjectValues(config, modelClass =>
            typeof modelClass.schema === "function" ? modelClass.schema() : modelClass.schema,
        ),
        {
            getType: model => {
                return assertExists(
                    typeByModelClass.get(model.constructor),
                    "Model must be directly instantiated from a class in the model union schema, no inheritance allowed",
                );
            },
            ...(typeKey !== undefined
                ? {serializedTypeKey: typeKey, deserializedTypeKey: typeKey}
                : {}),
        },
    ) as Schema<InstanceType<Config[keyof Config]>>;
}
