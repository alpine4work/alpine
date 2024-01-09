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

        assert(Number.isInteger(segmentIndex));
        assert(Number.isInteger(totalSegmentCount));
        assert(0 <= segmentIndex);
        assert(segmentIndex < totalSegmentCount);

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
