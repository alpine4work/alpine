import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {generateId} from "~/shared/id/id.open_source.js";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);

test("can not escalate request context into system context", () => {
    expect(() =>
        context
            .action(session)
            .clone({actor: SystemActorContextModule.dangerouslyNew("Test", generateId())}),
    ).toThrow();
});
