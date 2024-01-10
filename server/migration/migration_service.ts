import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {allMigrations} from "~/server/migration/all_migrations.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {runService} from "~/server/node/run_service.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";

// NOTE(calebmer): My vision for `MigrationService`:
//
// Right now migration service is pretty bare bones. It only runs a migration
// to index all search entities in OpenSearch and must be triggered manually.
// However, in the future I'd like for `MigrationService` to run new migrations
// automatically in development and production.
//
// Say an AWS lambda runs after a deploy completes, checks if all migrations
// have been run by looking at a DynamoDB table, and kicks off ECS tasks for
// any migrations which need to run. A similar process would happen in
// development. If we see new migrations, we run them.
//
// A system like this would allow developers to conveniently write arbitrary
// data schema changes. Though new migrations should probably get extra
// scrutiny during code review since they may corrupt data or increased load as
// they slow down the product.

runService({
    serviceName: "MigrationService",
    withoutCluster: true,
    options: {
        migration: {type: "string"},
        segmentIndex: {type: "string", default: "0"},
        totalSegmentCount: {type: "string", default: "1"},
        ...serverProcessContextParseOptions,
    },
    run: async ({
        tracer,
        options: {
            migration: migrationString,
            segmentIndex: segmentIndexString,
            totalSegmentCount: totalSegmentCountString,
            ...options
        },
    }) => {
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

        const awsSigner = new AwsRequestSigner();

        const processContext = createServerProcessContext({
            tracer,
            awsSigner,
            options,
        });

        await processContext.tracer.withSpan(
            `Run migration ${migrationString}`,
            async (context, span) => {
                span.addPropagatedData({context: {migration: migrationString}});
                span.addData({migration: {segmentIndex, totalSegmentCount}});

                await migration(context, {segmentIndex, totalSegmentCount});
            },
        );
    },
});
