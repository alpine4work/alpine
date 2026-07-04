import {
    ObjectSchema,
    ObjectSchemaConfigBase,
    ObjectSchemaConfigType,
    Schema,
    SchemaType,
} from "~/shared/schema/schema.js";

/**
 * A set of RPC method definitions for a web worker. Keys are method names, values
 * carry the input and output schemas.
 */
export type WebWorkerRpcMethodDefinitions = {
    readonly [name: string]: {
        readonly inputSchema: ObjectSchema<any>;
        readonly outputSchema: ObjectSchema<any>;
    };
};

export type WebWorkerRpcMethodTypes<Defs extends WebWorkerRpcMethodDefinitions> = {
    [K in keyof Defs]: {
        input: SchemaType<Defs[K]["inputSchema"]>;
        output: SchemaType<Defs[K]["outputSchema"]>;
    };
};

/**
 * Define a set of RPC methods for a web worker. Each key is a method name; each
 * value has `input` and `output` schema configs that get compiled into {@link
 * ObjectSchema} instances.
 *
 * ```ts
 * const methods = defineWebWorkerRpcMethods({
 *     executeQuery: {
 *         input: {sql: Schema.string()},
 *         output: {rows: Schema.array(Schema.unknown())},
 *     },
 * });
 * ```
 */
export function defineWebWorkerRpcMethods<
    Config extends {
        [name: string]: {
            input: ObjectSchemaConfigBase;
            output: ObjectSchemaConfigBase;
        };
    },
>(
    config: Config,
): {
    readonly [K in keyof Config]: {
        readonly inputSchema: ObjectSchema<ObjectSchemaConfigType<Config[K]["input"]>>;
        readonly outputSchema: ObjectSchema<ObjectSchemaConfigType<Config[K]["output"]>>;
    };
} {
    const methods: any = {};
    for (const name of Object.keys(config)) {
        const {input, output} = config[name]!;
        methods[name] = {
            inputSchema: Schema.object(input),
            outputSchema: Schema.object(output),
        };
    }
    return methods;
}
