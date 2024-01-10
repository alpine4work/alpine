import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {Construct} from "constructs";

export class AwsSqs extends Construct {
    private readonly _jobQueue: Queue;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "Sqs");

        const jobDeadLetterQueue = new Queue(this, "JobDeadLetterQueue");

        this._jobQueue = new Queue(this, "JobQueue", {
            deadLetterQueue: {
                queue: jobDeadLetterQueue,
                maxReceiveCount: 5,
            },
        });
    }

    public getJobQueueUrl() {
        return this._jobQueue.queueUrl;
    }

    public grantSendAndReceiveJobQueueMessages(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:ChangeMessageVisibility",
                ],
                resources: [this._jobQueue.queueArn],
            }),
        );
    }

    public grantSendJobQueueMessages(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["sqs:SendMessage"],
                resources: [this._jobQueue.queueArn],
            }),
        );
    }
}
