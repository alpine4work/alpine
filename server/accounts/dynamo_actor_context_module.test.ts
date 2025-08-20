import {DynamoSystemActorContextModule} from "~/server/context/dynamo_actor_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);

test("can not escalate request context into system context", () => {
    expect(() =>
        context
            .action(session)
            .clone({actor: DynamoSystemActorContextModule.dangerouslyNew("Test", generateId())}),
    ).toThrow();
});
