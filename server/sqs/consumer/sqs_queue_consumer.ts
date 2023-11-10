import {SQSClient} from "@aws-sdk/client-sqs";

export class SqsQueueConsumer {
    private readonly _client: SQSClient;

    constructor({region}: {region: string}) {
        this._client = new SQSClient({region});
    }
}
