import {
    DynamoActorContextModule,
    DynamoUnknownActorContextModule,
} from "~/server/context/dynamo_actor_context_module.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

export function isServerActionContext<Modules extends ServerProcessContextModules>(
    context: Context<Modules>,
): context is Context<
    Modules & Omit<ServerActionContextModules, keyof ServerProcessContextModules>
> {
    // If we add more context modules to action in the future, TypeScript will
    // error here. If you see an error here it means you need to update this
    // function to include a test for the new module!
    assertEqualTypes<
        Omit<ServerActionContextModules, keyof ServerProcessContextModules>,
        {
            cache: CacheContextModule;
            batch: BatchContextModule;
            actor: DynamoActorContextModule;
        }
    >();

    return (
        (context as any).cache instanceof CacheContextModule &&
        (context as any).batch instanceof BatchContextModule &&
        (context as any).actor instanceof DynamoUnknownActorContextModule
    );
}
