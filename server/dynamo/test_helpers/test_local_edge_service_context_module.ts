import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

let durableObjectBroadcasts: Array<{
    readonly url: `/api/durable-objects/${string}`;
    readonly body: SchemaSerializedValue | null | undefined;
}> = [];

testSharedHooks.beforeEach(async () => {
    durableObjectBroadcasts = [];
});

testSharedHooks.afterEach(async () => {
    durableObjectBroadcasts = [];
});

/**
 * An implementation of `EdgeServiceContextModuleBase` for tests that records
 * edge service calls so tests can inspect them.
 */
export class TestLocalEdgeServiceContextModule
    extends ContextModuleBase
    implements EdgeServiceContextModuleBase
{
    constructor() {
        // Should only be used in tests.
        assert(process.env.NODE_ENV === "test");

        super();
    }

    public async broadcastToDurableObject(
        url: `/api/durable-objects/${string}`,
        {
            body,
        }: {
            serviceName: TokenServiceName;
            route: `/api/durable-objects/${string}`;
            body?: SchemaSerializedValue | null;
        },
    ): Promise<void> {
        durableObjectBroadcasts.push({url, body});
    }

    public static getDurableObjectBroadcasts(): ReadonlyArray<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }> {
        return durableObjectBroadcasts;
    }

    public static takeDurableObjectBroadcasts(): ReadonlyArray<{
        readonly url: `/api/durable-objects/${string}`;
        readonly body: SchemaSerializedValue | null | undefined;
    }> {
        const broadcasts = durableObjectBroadcasts;
        durableObjectBroadcasts = [];
        return broadcasts;
    }

    public fork() {
        return new TestLocalEdgeServiceContextModule();
    }
}
