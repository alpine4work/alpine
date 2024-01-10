import fs from "fs-extra";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {JobQueueConsumer} from "~/server/jobs/queue/job_queue_consumer.js";
import {processJob} from "~/server/jobs/queue/process_job.js";
import {AllMiniLmL6V2LanguageModel} from "~/server/language_models/all_mini_lm_l6_v2/all_mini_lm_l6_v2_language_model.js";
import {CohereEmbedEnglishV3LanguageModel} from "~/server/language_models/cohere_embed_english_v3/cohere_embed_english_v3_language_model.js";
import {LanguageModelContextModule} from "~/server/language_models/core/language_model_context_module.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {serviceTokenAgentParseOptions} from "~/server/node/create_service_token_agent.js";
import {runService} from "~/server/node/run_service.js";
import {registerShutdownListenerForIngressTraffic} from "~/server/node/shutdown_manager.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

runService({
    serviceName: "JobQueueService",
    options: {
        allMiniLmL6V2LanguageModel: {type: "string"},
        cohereApiKey: {type: "string"},
        ...serviceTokenAgentParseOptions,
        ...serverProcessContextParseOptions,
    },
    run: async ({options, tracer}) => {
        const jobQueueUrl = assertExists(options.jobQueueUrl, "Missing `jobQueueUrl` option");

        // In development, wait for our local SQS server to start before starting
        // the `JobQueueService`.
        {
            const parsedJobQueueUrl = new URL(jobQueueUrl);
            if (parsedJobQueueUrl.hostname === "localhost") {
                await waitForHttpServer(parseInt(parsedJobQueueUrl.port, 10));
            }
        }

        const awsSigner = new AwsRequestSigner();

        const languageModel =
            process.env.NODE_ENV === "production"
                ? new CohereEmbedEnglishV3LanguageModel({
                      apiKey: assertExists(
                          options.cohereApiKey,
                          "`cohereApiKey` option is required in production",
                      ),
                  })
                : await AllMiniLmL6V2LanguageModel.new(
                      assertExists(
                          options.allMiniLmL6V2LanguageModel,
                          "`allMiniLmL6V2LanguageModel` option is required in development",
                      ),
                  );

        const processContext = createServerProcessContext({
            tracer,
            awsSigner,
            options,
        }).clone({
            languageModel: new LanguageModelContextModule(languageModel),
        });

        const consumer = JobQueueConsumer.start(processContext, {
            region: "us-east-1",
            queueUrl: jobQueueUrl,
            processJob,
        });

        registerShutdownListenerForIngressTraffic(async () => {
            consumer.stop();
        });

        // In production, we communicate that our process is healthy by writing to a
        // healthcheck file.
        if (process.env.NODE_ENV === "production") {
            await fs.writeFile("/var/www-data/server_jobs_queue_healthcheck.txt", "Healthy\n");
        }

        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Waiting for jobs from queue (pid ${process.pid})`);
        }
    },
});
