import {SQSClient} from "@aws-sdk/client-sqs";

export class SqsQueueProducer<Message> {
    private readonly _client: SQSClient;

    constructor({region}: {region: string}) {
        this._client = new SQSClient({region});
    }
}
