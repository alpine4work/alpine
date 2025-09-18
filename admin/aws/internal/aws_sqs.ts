import {CfnOutput, Fn, Stack} from "aws-cdk-lib";
import {SqsQueue, SqsQueueProps} from "aws-cdk-lib/aws-events-targets";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {IQueue, Queue} from "aws-cdk-lib/aws-sqs";
import {Construct} from "constructs";

export class AwsSqs {
    private readonly _jobQueue: IQueue;
    private readonly _fileProcessorJobQueue: IQueue;
    private readonly _fileProcessorLightJobQueue: IQueue;
    private readonly _fileProcessorHeavyJobQueue: IQueue;

    private constructor(
        jobQueue: IQueue,
        fileProcessorJobQueue: IQueue,
        fileProcessorLightJobQueue: IQueue,
        fileProcessorHeavyJobQueue: IQueue,
    ) {
        this._jobQueue = jobQueue;
        this._fileProcessorJobQueue = fileProcessorJobQueue;
        this._fileProcessorLightJobQueue = fileProcessorLightJobQueue;
        this._fileProcessorHeavyJobQueue = fileProcessorHeavyJobQueue;
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

        const fileProcessorJobDeadLetterQueue = new Queue(
            construct,
            "FileProcessorJobDeadLetterQueue",
        );

        const fileProcessorJobQueue = new Queue(construct, "FileProcessorJobQueue", {
            deadLetterQueue: {
                queue: fileProcessorJobDeadLetterQueue,
                maxReceiveCount: 5,
            },
        });

        // TODO(ifitzsimmons, #file-processor-service-migration): When the record is dropped from
        // the new processor use the originl FileProcessorJobQueue as the DLQ. This way, jobs that
        // cannot be processed by the new Lambda processor will be retried by the ECS service.
        // Once we have tuned the Lambdas accordingly, we can remove this queue and create a
        // dedicated DLQ.
        // When we are ready to clean up, we'll create a new DLQ for the Light processor and hook
        // it up here
        const fileProcessorLightJobQueue = new Queue(construct, "FileProcessorLightJobQueue", {
            deadLetterQueue: {
                queue: fileProcessorJobQueue,
                maxReceiveCount: 5,
            },
        });

        // TODO(ifitzsimmons, #file-processor-service-migration): When the record is dropped from
        // the new processor use the originl FileProcessorJobQueue as the DLQ. This way, jobs that
        // cannot be processed by the new Lambda processor will be retried by the ECS service.
        // Once we have tuned the Lambdas accordingly, we can remove this queue and create a
        // dedicated DLQ.
        // When we are ready to clean up, we'll create a new DLQ for the Heavy processor and hook
        // it up here
        const fileProcessorHeavyJobQueue = new Queue(construct, "FileProcessorHeavyJobQueue", {
            deadLetterQueue: {
                queue: fileProcessorJobQueue,
                maxReceiveCount: 5,
            },
        });

        return new AwsSqs(
            jobQueue,
            fileProcessorJobQueue,
            fileProcessorLightJobQueue,
            fileProcessorHeavyJobQueue,
        );
    }

    public getJobQueueUrl() {
        return this._jobQueue.queueUrl;
    }

    public getFileProcessorJobQueueUrl() {
        return this._fileProcessorJobQueue.queueUrl;
    }

    public getJobQueueArn() {
        return this._jobQueue.queueArn;
    }

    public getFileProcessorJobQueueArn() {
        return this._fileProcessorJobQueue.queueArn;
    }

    public getFileProcessorLightJobQueueUrl() {
        return this._fileProcessorLightJobQueue.queueUrl;
    }

    public getFileProcessorLightJobQueueArn() {
        return this._fileProcessorLightJobQueue.queueArn;
    }

    public getFileProcessorHeavyJobQueueUrl() {
        return this._fileProcessorHeavyJobQueue.queueUrl;
    }

    public getFileProcessorHeavyJobQueueArn() {
        return this._fileProcessorHeavyJobQueue.queueArn;
    }

    public getFileProcessorLightJobQueue() {
        return this._fileProcessorLightJobQueue;
    }

    public getFileProcessorHeavyJobQueue() {
        return this._fileProcessorHeavyJobQueue;
    }

    public getFileProcessorJobQueue() {
        return this._fileProcessorJobQueue;
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
                resources: [
                    this._jobQueue.queueArn,
                    this._fileProcessorJobQueue.queueArn,
                    this._fileProcessorLightJobQueue.queueArn,
                    this._fileProcessorHeavyJobQueue.queueArn,
                ],
            }),
        );
    }

    public grantSendJobQueueMessages(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["sqs:SendMessage"],
                resources: [
                    this._jobQueue.queueArn,
                    this._fileProcessorJobQueue.queueArn,
                    this._fileProcessorLightJobQueue.queueArn,
                    this._fileProcessorHeavyJobQueue.queueArn,
                ],
            }),
        );
    }

    public grantSendAndReceiveJobQueueMessagesForOnlyFileProcessorQueue(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:ChangeMessageVisibility",
                ],
                resources: [this._fileProcessorJobQueue.queueArn],
            }),
        );
    }

    public grantSendAndReceiveJobQueueMessagesForOnlyFileProcessorLightQueue(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:ChangeMessageVisibility",
                ],
                resources: [this._fileProcessorLightJobQueue.queueArn],
            }),
        );
    }

    public grantSendAndReceiveJobQueueMessagesForOnlyFileProcessorHeavyQueue(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: [
                    "sqs:SendMessage",
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:ChangeMessageVisibility",
                ],
                resources: [this._fileProcessorHeavyJobQueue.queueArn],
            }),
        );
    }

    public export() {
        new CfnOutput(this._jobQueue.stack, "JobQueueArnExport", {
            value: this._jobQueue.queueArn,
            exportName: `${this._jobQueue.stack.stackName}:JobQueueArn`,
        });

        new CfnOutput(this._jobQueue.stack, "FileProcessorJobQueueArnExport", {
            value: this._jobQueue.queueArn,
            exportName: `${this._jobQueue.stack.stackName}:FileProcessorJobQueueArn`,
        });

        new CfnOutput(this._jobQueue.stack, "FileProcessorLightJobQueueArnExport", {
            value: this._fileProcessorLightJobQueue.queueArn,
            exportName: `${this._jobQueue.stack.stackName}:FileProcessorLightJobQueueArn`,
        });

        new CfnOutput(this._jobQueue.stack, "FileProcessorHeavyJobQueueArnExport", {
            value: this._fileProcessorHeavyJobQueue.queueArn,
            exportName: `${this._jobQueue.stack.stackName}:FileProcessorHeavyJobQueueArn`,
        });

        return (importStack: Stack) =>
            new AwsSqs(
                Queue.fromQueueArn(
                    importStack,
                    "JobQueueImport",
                    Fn.importValue(`${this._jobQueue.stack.stackName}:JobQueueArn`),
                ),
                Queue.fromQueueArn(
                    importStack,
                    "FileProcessorJobQueueImport",
                    Fn.importValue(`${this._jobQueue.stack.stackName}:FileProcessorJobQueueArn`),
                ),
                Queue.fromQueueArn(
                    importStack,
                    "FileProcessorLightJobQueueImport",
                    Fn.importValue(
                        `${this._jobQueue.stack.stackName}:FileProcessorLightJobQueueArn`,
                    ),
                ),
                Queue.fromQueueArn(
                    importStack,
                    "FileProcessorHeavyJobQueueImport",
                    Fn.importValue(
                        `${this._jobQueue.stack.stackName}:FileProcessorHeavyJobQueueArn`,
                    ),
                ),
            );
    }
}
