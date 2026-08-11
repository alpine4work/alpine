import {Process, ProcessOptions, Sandbox} from "@cloudflare/sandbox";
import {AgentV2ServiceEnv} from "~/server/agents/bots_v2/internal/agent_v2_service_env.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleOkResponse} from "~/server/helpers/create_simple_ok_response.js";
import {KinesisClient, KinesisPutRecordsRequestEntry} from "~/server/kinesis/kinesis_client.js";
import {
    sendTracerEventsToHoneycomb,
    sendTracerEventsToKinesis,
} from "~/server/tracer/tracer_client.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data.open_source.js";
import {convertTracerEventFlatDataToKinesisData} from "~/shared/tracer/tracer_event.open_source.js";

export class ClaudeAgentSandbox extends Sandbox<AgentV2ServiceEnv> {
    #initializePromise: Promise<{branch: string}> | null = null;

    initialize(): Promise<{branch: string}> {
        if (this.#initializePromise !== null) {
            return this.#initializePromise.then(() => ({branch: "AlreadyInitialized"}));
        } else {
            this.#initializePromise = this.#initialize();
            return this.#initializePromise;
        }
    }

    async #initialize(): Promise<{branch: string}> {
        // Looks like the bucket was already mounted? So we noop. We expect this may happen
        // in production when the durable object code deploys so the durable object
        // JavaScript class resets but the underlying Docker container is still running.
        // But I (@calebmer) am not 100% sure if this case will ever really happen.
        if (await this.exists("/workspace/bucket")) return {branch: "BucketAlreadyMounted"};

        // `getSandbox()` uses `idFromName()`, so this is the original sandbox ID.
        const sandboxId = assertExists(this.ctx.id.name);
        const bucketPrefix = `/sandbox/${sandboxId}/`;

        await this.mountBucket(
            "ClaudeAgentBucket",
            // `localBucket: true` complains if the mount path is not within `/workspace`.
            "/workspace/bucket",
            process.env.NODE_ENV !== "production"
                ? {localBucket: true, prefix: bucketPrefix}
                : {prefix: bucketPrefix},
        );

        // Be very careful what you put in here! Claude will be able to access all of this
        // and if we ever give Claude the bash tool it will be able to abuse these
        // variables.
        await this.setEnvVars({
            ALPINE_URL: assertExists(this.env.EDGE_SERVICE_URL),
            ALPINE_API_URL: assertExists(this.env.API_SERVICE_URL),
            ALPINE_API_KEY: assertExists(this.env.CLAUDE_API_SERVICE_KEY),
        });

        return {branch: "Initialized"};
    }

    override async startProcess(
        command: string,
        options?: ProcessOptions,
        sessionId?: string,
    ): Promise<Process> {
        if (process.env.NODE_ENV === "production") {
            return await super.startProcess(command, options, sessionId);
        }

        return await super.startProcess(
            command,
            {
                ...options,
                onOutput: (stream, data) => {
                    // Simply forward all stdout/stderr in development from the sandbox to worker logs.
                    // The logs are printed plainly in development.

                    // eslint-disable-next-line no-console
                    console.log(data.trimEnd());
                },
            },
            sessionId,
        );
    }
}

ClaudeAgentSandbox.outboundByHost = {
    "tracer.cyberworlds.dev": async (request, env: AgentV2ServiceEnv, ctx) => {
        const events: Array<{time: number; data: TracerEventFlatData}> = await request.json();

        if (!env.HONEYCOMB_API_KEY) {
            if (process.env.NODE_ENV === "production") {
                throw new InternalError("Must provide `HONEYCOMB_API_KEY` in production");
            }

            for (const event of events) {
                // Make sure every event coming from the sandbox sets `meta.untrusted` to true and
                // set the right `service.name`. We can't trust events coming from the sandbox
                // because Claude might discover how to send events and start sending us trash
                // events. This way if we suspect incorrect events, we can easily filter them out
                // on the server.
                assert(event.data["service.name"] === "ClaudeAgentService");
                assert(event.data["meta.untrusted"] === true);

                // Make sure to add the container ID to logged events. So we can correlate events
                // coming from the same container.
                event.data["cloudflare.containers.id"] = ctx.containerId;
            }

            return createSimpleOkResponse();
        }

        const kinesisTracerStreamName = env.KINESIS_TRACER_STREAM_NAME;
        if (!kinesisTracerStreamName && process.env.NODE_ENV === "production") {
            throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");
        }

        const kinesisTracerStreamOptions = kinesisTracerStreamName
            ? {
                  streamName: kinesisTracerStreamName,
                  awsSigner: new AwsRequestSigner({
                      accessKeyId: assertExists(
                          env.KINESIS_AWS_ACCESS_KEY_ID,
                          "`KINESIS_AWS_ACCESS_KEY_ID` is required",
                      ),
                      secretAccessKey: assertExists(
                          env.KINESIS_AWS_SECRET_ACCESS_KEY,
                          "`KINESIS_AWS_SECRET_ACCESS_KEY` is required",
                      ),
                  }),
              }
            : undefined;

        const kinesisClient = kinesisTracerStreamOptions
            ? new KinesisClient(
                  "https://kinesis.us-east-1.amazonaws.com",
                  kinesisTracerStreamOptions.streamName,
                  kinesisTracerStreamOptions.awsSigner,
              )
            : undefined;

        await runAllPromises([
            sendTracerEventsToHoneycomb(
                env.HONEYCOMB_API_KEY,
                "tracer",
                events.map(event => {
                    // Make sure every event coming from the sandbox sets `meta.untrusted` to true and
                    // set the right `service.name`. We can't trust events coming from the sandbox
                    // because Claude might discover how to send events and start sending us trash
                    // events. This way if we suspect incorrect events, we can easily filter them out
                    // on the server.
                    assert(event.data["service.name"] === "ClaudeAgentService");
                    assert(event.data["meta.untrusted"] === true);

                    return {
                        time: serializeDateString(new Date(event.time)),
                        data: event.data,
                    };
                }),
            ),
            // TODO(ifitzsimmons, #local-kinesis): In order to convert our log architecture
            // such that all events go through Kinesis and are then forwarded to Honeycomb, we
            // need to figure out how to represent this in our local environment. In the
            // meantime, we are only using Kinesis to get our log data into S3, so this process
            // is only necessary in production.
            kinesisClient
                ? sendTracerEventsToKinesis(
                      kinesisClient,
                      events.map(
                          (event): KinesisPutRecordsRequestEntry => ({
                              data: convertTracerEventFlatDataToKinesisData(event),
                              partitionKey:
                                  (event.data["trace.trace_id"] as string | undefined) ??
                                  (event.data["trace.span_id"] as string | undefined) ??
                                  generateId(),
                          }),
                      ),
                  )
                : null,
        ]);

        return createSimpleOkResponse();
    },
};
