import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {finishInitializingDynamoTableSchemas} from "~/server/dynamo/core/dynamo_table_schema.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {allMigrations} from "~/server/migration/all_migrations.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {
    createServiceOpensearchContextModule,
    serviceOpensearchOptions,
} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// NOTE(calebmer): My vision for `MigrationService`:
//
// Right now migration service is pretty bare bones. It only runs a migration to
// index all search entities in OpenSearch and must be triggered manually. However,
// in the future I'd like for `MigrationService` to run new migrations
// automatically in development and production.
//
// Say an AWS lambda runs after a deploy completes, checks if all migrations have
// been run by looking at a DynamoDB table, and kicks off ECS tasks for any
// migrations which need to run. A similar process would happen in development. If
// we see new migrations, we run them.
//
// A system like this would allow developers to conveniently write arbitrary data
// schema changes. Though new migrations should probably get extra scrutiny during
// code review since they may corrupt data or temporarily increase load as they
// slow down the product.
//
// Until `MigrationService` runs automatically, you need to manually run migrations
// using the AWS CLI. For example, this is the exact command we ran once to index
// every search entity. Review every parameter before running this. Our
// infrastructure may have changed.
//
// ```
// aws ecs run-task \
//     --region us-east-1 \
//     --cluster CyberworldsStack-EcsClusterFB9B21B5-p2LyPDHsiIZt \
//     --task-definition CyberworldsStackMigrationServiceTaskDefinition8D9EC5A4 \
//     --count 1 \
//     --launch-type FARGATE \
//     --network-configuration '{"awsvpcConfiguration":{"subnets": ["subnet-0c30df1482954b4c2", "subnet-0f36625ac7e01c458"], "securityGroups": ["sg-01e7a96e5206eb5bd"], "assignPublicIp": "ENABLED"}}' \
//     --overrides '{"containerOverrides":[{"name": "Container", "environment": [{"name": "MIGRATION", "value": "IndexEverySearchEntity"}, {"name": "SEGMENT_INDEX", "value": "0"}, {"name": "TOTAL_SEGMENT_COUNT", "value": "1"}]}]}'
// ```

type Options = ServiceOptions<typeof options>;

export const options = {
    migration: {type: "string"},
    segmentIndex: {type: "string", default: "0"},
    totalSegmentCount: {type: "string", default: "1"},
    ...serverBasicProcessContextOptions,
    ...serviceOpensearchOptions,
} as const;

export async function run({
    tracer,
    startupSpan,
    shutdownManager,
    options: {
        migration: migrationString,
        segmentIndex: segmentIndexString,
        totalSegmentCount: totalSegmentCountString,
        ...options
    },
}: {
    tracer: TracerRoot;
    startupSpan: TracerSpan;
    shutdownManager: ShutdownManager;
    options: Options;
}) {
    if (!migrationString) throw new InvalidArgumentError("Expected `migration` option");

    const segmentIndex = parseFloat(assertExists(segmentIndexString));
    const totalSegmentCount = parseFloat(assertExists(totalSegmentCountString));

    assert(Number.isInteger(segmentIndex), "Expected valid `segmentIndex` option");
    assert(Number.isInteger(totalSegmentCount), "Expected valid `totalSegmentCount` option");
    assert(0 <= segmentIndex, "Expected valid `segmentIndex` option");
    assert(segmentIndex < totalSegmentCount, "Expected valid `segmentIndex` option");

    const migration = allMigrations[migrationString];
    if (!migration) {
        throw new InvalidArgumentError(quote`Migration named ${migrationString} not found`);
    }

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const opensearchContextModule = createServiceOpensearchContextModule(awsSigner, options);

    const processContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        opensearch: opensearchContextModule,
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
    });

    try {
        await processContext.tracer.withSpan(
            `Run migration ${migrationString}`,
            async (context, span) => {
                span.addPropagatedData({context: {migration: migrationString}});
                span.addData({migration: {segmentIndex, totalSegmentCount}});

                // Make sure to finish initializing all DynamoDB table schemas before we start our
                // migration.
                finishInitializingDynamoTableSchemas();

                await migration(context, {segmentIndex, totalSegmentCount});
            },
        );
    } catch (error) {
        throw error;
    }
}
