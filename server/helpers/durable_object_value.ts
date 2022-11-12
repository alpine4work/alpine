import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";

export class DurableObjectValue<T> {
    static async create<T>(
        storage: DurableObjectStorage,
        key: string,
        schema: Schema<T>,
        getDefaultValue: () => T,
    ): Promise<DurableObjectValue<T>> {
        const value = await storage.get(key);
        if (value) {
            return new DurableObjectValue(
                storage,
                key,
                schema,
                schema.deserialize(value as SchemaSerializedValue),
            );
        } else {
            const defaultValue = getDefaultValue();
            if (defaultValue != null) {
                void storage.put(key, schema.serialize(defaultValue));
            }
            return new DurableObjectValue(storage, key, schema, defaultValue);
        }
    }

    static createNullable<T>(
        storage: DurableObjectStorage,
        key: string,
        schema: Schema<T>,
        getDefaultValue?: () => T,
    ): Promise<DurableObjectValue<T | null>> {
        return DurableObjectValue.create(
            storage,
            key,
            schema.nullable(),
            getDefaultValue ?? (() => null),
        );
    }

    private constructor(
        private readonly storage: DurableObjectStorage,
        private readonly key: string,
        private readonly schema: Schema<T>,
        private cachedValue: T,
    ) {}

    get(): T {
        return this.cachedValue;
    }

    set(newValue: T): void {
        void this.storage.put(this.key, this.schema.serialize(newValue));
        this.cachedValue = newValue;
    }

    setIn<K extends keyof T>(key: K, value: T[K]): void {
        this.set({
            ...this.cachedValue,
            [key]: value,
        });
    }
}
