import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {ObjectSchema, Schema} from "~/shared/schema/schema.js";

/**
 * The type of an immutable model object class.
 */
export interface ModelClass<Value> {
    new (value: Value): Model<Value>;
    /**
     * Gets a schema that will serialize this class and deserialize back into
     * this class.
     */
    // The schema needs to be a getter so that we can get access to the subclass
    // extending our base model class. That's why we write this type with a generic
    // `This`.
    schema<This extends ModelClass<Value>>(this: This): Schema<InstanceType<This>>;
}

/**
 * The type of an immutable model object.
 */
export type Model<Value> = Readonly<Value> & ModelInterface<Value>;

interface ModelInterface<Value> {
    /**
     * Clone the model object, replacing any values with those provided in the
     * partial value.
     */
    clone(partialValue: Partial<Value>): this;
}

/**
 * Creates a model object class.
 *
 * A model is an immutable object with some methods for deriving information
 * from the underlying data.
 *
 * We recommend extending the model object class so you can add helper methods.
 *
 * If you extend the model object class be careful about overriding the
 * constructor. The model knows how to clone itself and will pass `Value` into
 * the constructor.
 *
 * This is a simple helper on top of our schema library which is why it lives
 * in `~/shared/schema`.
 */
export function Model<Value>(schema: ObjectSchema<Value>): ModelClass<Value> {
    class Model {
        private static _schema?: Schema<Model>;

        // The schema needs to be a getter so that we can get access to the subclass
        // extending our base model class.
        public static schema(): Schema<Model> {
            // Each distinct class in this model class's hierarchy chain should have its
            // own `_schema` property. We don't want to inherit a schema from our base
            // class! Which is why we use `hasOwnProperty()` here.
            if (!hasOwnProperty(this, "_schema")) {
                this._schema = schema.transform<Model>({
                    serialize: model => {
                        const value: any = {};

                        for (const key of schema.propertySchemaByKey.keys()) {
                            if (!hasOwnProperty(model, key)) continue;
                            value[key] = (model as any)[key];
                        }

                        return value;
                    },
                    deserialize: value => {
                        // We call `new this()` instead of `new Model()` so that we use the subclass
                        // instead of the base model class.
                        //
                        // This does depend on subclasses not mucking with the constructor function.
                        return new this(value);
                    },
                });
            }

            return this._schema!;
        }

        constructor(value: Value) {
            for (const key of schema.propertySchemaByKey.keys()) {
                if (!hasOwnProperty(value, key)) continue;
                (this as any)[key] = (value as any)[key];
            }
        }

        public clone(partialValue: Partial<Value>): this {
            const newValue: any = {};

            for (const key of schema.propertySchemaByKey.keys()) {
                if (hasOwnProperty(partialValue, key)) {
                    const keyValue = (partialValue as any)[key];

                    // Treat an `undefined` value and a missing property as the same since the
                    // `Partial` type allows `undefined` for any key (not jut optional keys).
                    //
                    // This does mean you can't remove an optional property by setting it to
                    // `undefined`. We need some other tactic for that. (Maybe we should encourage
                    // `schema.nullable().default(null)` instead of `schema.optional()`?)
                    if (keyValue !== undefined) {
                        newValue[key] = keyValue;
                        continue;
                    }
                }

                if (hasOwnProperty(this, key)) {
                    newValue[key] = (this as any)[key];
                    continue;
                }
            }

            // We call `new this.constructor()` instead of `new Model()` so that we use the
            // subclass instead of the base model class.
            //
            // This does depend on subclasses not mucking with the constructor function.
            return new (this.constructor as any)(newValue);
        }
    }

    return Model as any;
}
