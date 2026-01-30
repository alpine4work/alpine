import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {
    ObjectSchema,
    ObjectSchemaConfigBase,
    ObjectSchemaConfigType,
    Schema,
    UnionSchema,
    UnionSchemaObjectConfigBase,
    UnionSchemaObjectConfigType,
} from "~/shared/schema/schema.js";

export type WebSocketProtocolBase = WebSocketProtocol<
    {[name: string]: {input: any; output: any}},
    any
>;

export type WebSocketProtocolProceduresType<Protocol extends WebSocketProtocolBase> =
    Protocol extends WebSocketProtocol<infer Procedures, any> ? Procedures : never;

export type WebSocketProtocolEventType<Protocol extends WebSocketProtocolBase> =
    Protocol extends WebSocketProtocol<any, infer Event> ? Event : never;

/**
 * The protocol for a WebSocket built with our WebSocket framework.
 */
export type WebSocketProtocol<
    Procedures extends {[name: string]: {input: {}; output: {}}},
    Event extends {type: string},
> = {
    /**
     * Client to server communication is done by executing procedures. WebSocket
     * servers always acknowledge whether a procedure call succeeded or failed. A
     * call may optionally return some data to the client.
     *
     * Name comes from [Remote Procedure Calls or RPCs][1].
     *
     * [1]: https://en.wikipedia.org/wiki/Remote_procedure_call
     */
    readonly procedureSchemas: {
        [Name in keyof Procedures]: {
            readonly inputSchema: ObjectSchema<Procedures[Name]["input"]>;
            readonly outputSchema: ObjectSchema<Procedures[Name]["output"]>;
        };
    };

    /**
     * Besides procedure responses, a WebSocket server may send an event to the client
     * outside of a procedure context.
     *
     * This capability is what distinguishes a persistent WebSocket connection from
     * HTTP oneshot requests.
     */
    readonly eventSchema: UnionSchema<Event>;
};

/**
 * Defines the protocol for a WebSocket built with our WebSocket framework. See
 * `WebSocketProtocol` for more information about the pieces of the protocol.
 */
export function defineWebSocketProtocol<
    ProceduresConfig extends {
        [name: string]: {input: ObjectSchemaConfigBase; output: ObjectSchemaConfigBase};
    },
    EventsConfig extends UnionSchemaObjectConfigBase<EventsConfig>,
>({
    procedures,
    events,
}: {
    procedures: ProceduresConfig;
    events: EventsConfig;
}): WebSocketProtocol<
    {
        [Name in keyof ProceduresConfig]: {
            input: ObjectSchemaConfigType<ProceduresConfig[Name]["input"]>;
            output: ObjectSchemaConfigType<ProceduresConfig[Name]["output"]>;
        };
    },
    UnionSchemaObjectConfigType<EventsConfig>
> {
    for (const type of Object.keys(events)) {
        assert(isIdentifier(type), "Event type should be a valid identifier");
        assert(
            type[0] === type[0]?.toUpperCase(),
            "Event type should start with an upper case letter",
        );
    }

    return {
        procedureSchemas: mapObjectValues(
            procedures,
            (
                procedureConfig,
                procedureName,
            ): {
                inputSchema: ObjectSchema<any>;
                outputSchema: ObjectSchema<any>;
            } => {
                assert(isIdentifier(procedureName), "Procedure name should be a valid identifier");
                assert(
                    procedureName[0] === procedureName[0]?.toLowerCase(),
                    "Procedure name should start with an lower case letter",
                );
                assert(
                    !("type" in procedureConfig.input),
                    "Input object can\u2019t contain `type` property",
                );
                assert(
                    !("type" in procedureConfig.output),
                    "Input object can\u2019t contain `type` property",
                );

                return {
                    inputSchema: Schema.object(procedureConfig.input),
                    outputSchema: Schema.object(procedureConfig.output),
                };
            },
        ),
        eventSchema: Schema.union(events),
    };
}
