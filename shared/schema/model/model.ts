import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {ObjectSchema, Schema} from "~/shared/schema/schema.js";

/**
 * The type of an immutable model object class.
 */
export interface ModelClass<Data> {
    new (data: Data): Model<Data>;
    /**
     * Gets a schema that will serialize this class and deserialize back into
     * this class.
     */
    // The schema needs to be a getter so that we can get access to the subclass
    // extending our base model class. That's why we write this type with a generic
    // `This`.
    schema<This extends ModelClass<Data>>(this: This): Schema<InstanceType<This>>;
}

/**
 * The type of an immutable model object.
 */
export type Model<Data> = Readonly<Data> & ModelInterface<Data>;

interface ModelInterface<Data> {
    /**
     * Clone the model object, replacing any data with those provided in the
     * partial data.
     */
    clone(partialData: Partial<Data>): this;
}

/**
 * Get the `Partial` type of the model's data.
 */
export type ModelPartialDataType<T extends Model<any>> = Parameters<T["clone"]>[0];

/**
 * Creates a model object class.
 *
 * A model is an immutable object with some methods for deriving information
 * from the underlying data.
 *
 * We recommend extending the model object class so you can add helper methods.
 *
 * If you extend the model object class be careful about overriding the
 * constructor. The model knows how to clone itself and will pass `Data` into
 * the constructor.
 *
 * This is a simple helper on top of our schema library which is why it lives
 * in `~/shared/schema`.
 */
export function Model<Data>(schema: ObjectSchema<Data>): ModelClass<Data> {
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
                        const data: any = {};

                        for (const key of schema.propertySchemaByKey.keys()) {
                            if (!hasOwnProperty(model, key)) continue;
                            data[key] = (model as any)[key];
                        }

                        return data;
                    },
                    deserialize: data => {
                        // We call `new this()` instead of `new Model()` so that we use the subclass
                        // instead of the base model class.
                        //
                        // This does depend on subclasses not mucking with the constructor function.
                        return new this(data);
                    },
                });
            }

            return this._schema!;
        }

        constructor(data: Data) {
            for (const key of schema.propertySchemaByKey.keys()) {
                if (!hasOwnProperty(data, key)) continue;
                (this as any)[key] = (data as any)[key];
            }
        }

        public clone(partialData: Partial<Data>): this {
            const newData: any = {};
            let hasChanged = false;

            for (const key of schema.propertySchemaByKey.keys()) {
                if (hasOwnProperty(partialData, key)) {
                    const value = (partialData as any)[key];

                    // Treat an `undefined` value and a missing property as the same since the
                    // `Partial` type allows `undefined` for any key (not jut optional keys).
                    //
                    // This does mean you can't remove an optional property by setting it to
                    // `undefined`. We need some other tactic for that. (Maybe we should encourage
                    // `schema.nullable().default(null)` instead of `schema.optional()`?)
                    if (value !== undefined) {
                        // If nothing changes during the clone, we return `this` to maintain
                        // referential identity.
                        if (!Object.is((this as any)[key], value)) {
                            hasChanged = true;
                        }

                        newData[key] = value;
                        continue;
                    }
                }

                if (hasOwnProperty(this, key)) {
                    newData[key] = (this as any)[key];
                    continue;
                }
            }

            if (!hasChanged) return this;

            // We use `new this.constructor()` instead of `new Model()` so that we
            // use the subclass instead of the base model class.
            //
            // This does depend on subclasses having the same constructor interface.
            //
            // We use `new this.constructor()` instead of
            // `Object.create(this.constructor.prototype)` in case the subclass has custom
            // constructor logic (e.g. computing custom properties). A non-obvious example
            // of custom constructor logic is class instance fields (e.g.
            // `public readonly type = "Chat"` in `InboxChatEntryModel`). These properties
            // are initialized when calling the constructor function.
            const newModel = new (this.constructor as any)(newData);

            return newModel;
        }
    }

    return Model as any;
}
