import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {KinesisClient} from "~/server/kinesis/kinesis_client.js";
import {HoneycombDataset, TracerClient} from "~/server/tracer/tracer_client.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {writeTracerEventToFileInDev} from "~/shared/tracer/dev/write_tracer_event_to_file_in_dev.js";
import {TracerRoot, TracerServiceName} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerEventJsHost} from "~/shared/tracer/types/tracer_event_data.open_source.js";

export function createLambdaTracerAndHoneycombClient({
    serviceName,
    jsHost,
    promiseWaiter,
    honeycombApiKey,
    honeycombDataset,
    kinesisTracerStreamName,
    awsSigner,
}: {
    serviceName: TracerServiceName;
    jsHost: TracerEventJsHost;
    promiseWaiter: PromiseWaiter;
    honeycombApiKey?: string;
    honeycombDataset?: HoneycombDataset;
    kinesisTracerStreamName: string;
    awsSigner: AwsRequestSigner;
}): [TracerRoot, TracerClient | null] {
    // If a Honeycomb API key is not provided in production then we get no logging from
    // our service.
    if (!honeycombApiKey && process.env.NODE_ENV === "production")
        throw new InternalError(
            "Must provide `honeycombApiKey` environment variable in production",
        );

    const tracer = TracerRoot.new({
        serviceName,
        jsHost,
        untrusted: false,
        clock: unsynchronizedSystemClock,
        sendEvent: event => {
            honeycombClient?.sendEvent(event);

            if (process.env.NODE_ENV !== "production") {
                writeTracerEventToFileInDev(event);
            }
        },
    });

    const honeycombClient = honeycombApiKey
        ? new TracerClient({
              apiKey: honeycombApiKey,
              tracer,
              waitUntil: promise => {
                  promiseWaiter.waitUntil(
                      promise.catch(error => {
                          // eslint-disable-next-line no-console
                          console.error("Exception from server tracer:");
                          // eslint-disable-next-line no-console
                          console.error(error);
                      }),
                  );
              },
              dataset: assertExists(
                  honeycombDataset,
                  "Must provide `honeycombDataset` when `honeycombApiKey` is provided",
              ),
              kinesis: new KinesisClient(
                  "https://kinesis.us-east-1.amazonaws.com",
                  kinesisTracerStreamName,
                  awsSigner,
              ),
          })
        : null;

    return [tracer, honeycombClient];
}
