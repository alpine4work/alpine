import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {KinesisClient} from "~/server/kinesis/kinesis_client.js";
import {HoneycombDataset, TracerClient} from "~/server/tracer/tracer_client.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/dev/write_tracer_event_to_file_in_dev.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data_types.open_source.js";

/**
 * Create a tracer for a service running in a server or Cloudflare Workers
 * environment.
 */
export function createServerTracer(options: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
    honeycombDataset: HoneycombDataset;
    // TODO(ifitzsimmons, #local-kinesis): This will eventually be required
    kinesisTracerStreamOptions?: {
        streamName: string;
        awsSigner: AwsRequestSigner;
    };
    withoutWriteToFileInDev?: boolean;
}): TracerRoot {
    return createServerTracerAndHoneycombClient(options)[0];
}

export function createServerTracerAndHoneycombClient({
    serviceName,
    jsHost,
    awsEc2InstanceId,
    awsEcsTaskId,
    honeycombApiKey,
    waitUntil,
    honeycombDataset,
    kinesisTracerStreamOptions,
    withoutWriteToFileInDev = false,
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    awsEc2InstanceId?: string;
    awsEcsTaskId?: string;
    honeycombApiKey: string | undefined;
    waitUntil: (promise: Promise<unknown>) => void;
    honeycombDataset: HoneycombDataset;
    /**
     * There is no local Kinesis stream so we don't need to pass in a stream name for
     * dev/test environments. See ##local-kinesis TODOs for more.
     */
    kinesisTracerStreamOptions?: {streamName: string; awsSigner: AwsRequestSigner};
    withoutWriteToFileInDev?: boolean;
}): [TracerRoot, TracerClient | null] {
    const tracer = TracerRoot.new({
        serviceName,
        jsHost,
        untrusted: false,
        awsEc2InstanceId,
        awsEcsTaskId,
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            honeycombClient?.sendEvent(event);

            if (process.env.NODE_ENV !== "production" && !withoutWriteToFileInDev) {
                writeTracerEventToFileInDev(event);
            }
        },
    });

    const kinesisClient = kinesisTracerStreamOptions
        ? new KinesisClient(
              "https://kinesis.us-east-1.amazonaws.com",
              kinesisTracerStreamOptions.streamName,
              kinesisTracerStreamOptions.awsSigner,
          )
        : undefined;

    const honeycombClient = honeycombApiKey
        ? new TracerClient({
              apiKey: honeycombApiKey,
              tracer,
              waitUntil,
              dataset: honeycombDataset,
              kinesis: kinesisClient,
          })
        : null;

    return [tracer, honeycombClient];
}
