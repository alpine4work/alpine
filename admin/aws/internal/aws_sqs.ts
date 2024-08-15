import {CfnOutput, Fn, Stack} from "aws-cdk-lib";
import {SqsQueue, SqsQueueProps} from "aws-cdk-lib/aws-events-targets";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {IQueue, Queue} from "aws-cdk-lib/aws-sqs";
import {Construct} from "constructs";

export class AwsSqs {
    private readonly _jobQueue: IQueue;

    private constructor(jobQueue: IQueue) {
        this._jobQueue = jobQueue;
    }

    public static new(parentConstruct: Construct) {
        const construct = new Construct(parentConstruct, "Sqs");

        const jobDeadLetterQueue = new Queue(construct, "JobDeadLetterQueue");

        const jobQueue = new Queue(construct, "JobQueue", {
            deadLetterQueue: {
                queue: jobDeadLetterQueue,
                maxReceiveCount: 5,
            },
        });

        return new AwsSqs(jobQueue);
    }

    public getJobQueueUrl() {
        return this._jobQueue.queueUrl;
    }

    public getJobQueueArn() {
        return this._jobQueue.queueArn;
    }

    public createJobQueueEventTarget(props?: SqsQueueProps) {
        return new SqsQueue(this._jobQueue, props);
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

    public export() {
        new CfnOutput(this._jobQueue.stack, "JobQueueArnExport", {
            value: this._jobQueue.queueArn,
            exportName: `${this._jobQueue.stack.stackName}:JobQueueArn`,
        });

        return (importStack: Stack) =>
            new AwsSqs(
                Queue.fromQueueArn(
                    importStack,
                    "JobQueueImport",
                    Fn.importValue(`${this._jobQueue.stack.stackName}:JobQueueArn`),
                ),
            );
    }
}
