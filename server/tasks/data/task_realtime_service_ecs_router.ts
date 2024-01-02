import {DescribeNetworkInterfacesCommand, EC2Client, NetworkInterface} from "@aws-sdk/client-ec2";
import {
    ContainerInstance,
    DescribeContainerInstancesCommand,
    DescribeTasksCommand,
    ECSClient,
    ListTasksCommand,
    Task,
} from "@aws-sdk/client-ecs";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {InternalError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

/**
 * Route requests to `TaskRealtimeService` by getting information about running
 * EC2 instances from [ECS][1].
 *
 * [1]: https://aws.amazon.com/ecs/
 */
export class TaskRealtimeServiceEcsRouter extends TaskRealtimeServiceRouterBase {
    private readonly _ecsClient: ECSClient;
    private readonly _ec2Client: EC2Client;
    private readonly _ecsCluster: string;
    private readonly _ecsTaskDefinitionFamily: string;

    constructor({
        region,
        ecsCluster,
        ecsTaskDefinitionFamily,
    }: {
        region: string;
        ecsCluster: string;
        ecsTaskDefinitionFamily: string;
    }) {
        super();
        this._ecsClient = new ECSClient({region});
        this._ec2Client = new EC2Client({region});
        this._ecsCluster = ecsCluster;
        this._ecsTaskDefinitionFamily = ecsTaskDefinitionFamily;
    }

    protected _loadRoutes(
        context: ServerProcessContext,
        {isBlocking}: {isBlocking: boolean},
    ): Promise<TaskRealtimeServiceRoutes> {
        return context.tracer.withSpan("Load task realtime service routes", (context, span) => {
            span.addData({common: {isBlocking}});

            return this._actuallyLoadRoutes(context);
        });
    }

    private async _actuallyLoadRoutes(
        context: ServerProcessContext,
    ): Promise<TaskRealtimeServiceRoutes> {
        let nextListTasksToken: string | undefined;
        const outputPromises: Array<
            Promise<{
                tasks: Array<Task>;
                containerInstanceByArn: Map<string, ContainerInstance>;
                networkInterfaceByInstanceId: Map<string, NetworkInterface>;
            }>
        > = [];

        try {
            do {
                // `ListTasks` can only return 100 entries at a time.
                const maxResults = 100;

                // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ListTasks.html
                const listTasksOutput = await context.tracer.withSpan(
                    "ECS ListTasks",
                    async (context, span) => {
                        const command = new ListTasksCommand({
                            maxResults,
                            cluster: this._ecsCluster,
                            family: this._ecsTaskDefinitionFamily,
                        });

                        span.addData({
                            aws: {
                                ecs: {
                                    cluster: command.input.cluster,
                                    taskDefinitionFamily: command.input.family,
                                },
                            },
                        });

                        const output = await this._ecsClient.send(command);

                        span.addData({
                            aws: {
                                ecs: {
                                    taskCount: output.taskArns?.length ?? 0,
                                },
                            },
                        });

                        return output;
                    },
                );

                outputPromises.push(
                    (async () => {
                        // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html
                        const describeTasksOutput = await context.tracer.withSpan(
                            "ECS DescribeTasks",
                            (context, span) => {
                                const command = new DescribeTasksCommand({
                                    cluster: this._ecsCluster,
                                    tasks: listTasksOutput.taskArns ?? [],
                                    include: ["TAGS"],
                                });

                                span.addData({
                                    aws: {
                                        ecs: {
                                            cluster: command.input.cluster,
                                            taskCount: command.input.tasks?.length ?? 0,
                                        },
                                    },
                                });

                                return this._ecsClient.send(command);
                            },
                        );

                        if ((describeTasksOutput.failures?.length ?? 0) > 0) {
                            throw new InternalError("Failed to describe some ECS task(s)");
                        }

                        // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeContainerInstances.html
                        const describeContainerInstancesOutput = await context.tracer.withSpan(
                            "ECS DescribeContainerInstances",
                            (context, span) => {
                                const command = new DescribeContainerInstancesCommand({
                                    cluster: this._ecsCluster,
                                    containerInstances: filterMapArray(
                                        describeTasksOutput.tasks ?? [],
                                        task => task.containerInstanceArn ?? null,
                                    ),
                                });

                                span.addData({
                                    aws: {
                                        ecs: {
                                            cluster: command.input.cluster,
                                            containerInstanceCount:
                                                command.input.containerInstances?.length ?? 0,
                                        },
                                    },
                                });

                                return this._ecsClient.send(command);
                            },
                        );

                        if ((describeContainerInstancesOutput.failures?.length ?? 0) > 0) {
                            throw new InternalError(
                                "Failed to describe some ECS container instance(s)",
                            );
                        }

                        // https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeNetworkInterfaces.html
                        const describeNetworkInterfacesOutput = await context.tracer.withSpan(
                            "EC2 DescribeNetworkInterfaces",
                            (context, span) => {
                                const command = new DescribeNetworkInterfacesCommand({
                                    // Same `maxResults` as our `ListTasks` command. If `ListTasks` has more than
                                    // `maxResults` we'll be making multiple requests.
                                    MaxResults: maxResults,
                                    Filters: [
                                        {
                                            Name: "attachment.instance-id",
                                            Values: filterMapArray(
                                                describeContainerInstancesOutput.containerInstances ??
                                                    [],
                                                containerInstance =>
                                                    containerInstance.ec2InstanceId ?? null,
                                            ),
                                        },
                                    ],
                                });

                                return this._ec2Client.send(command);
                            },
                        );

                        const containerInstanceByArn = new Map(
                            filterMapArray(
                                describeContainerInstancesOutput.containerInstances ?? [],
                                containerInstance => {
                                    const {containerInstanceArn} = containerInstance;
                                    if (!containerInstanceArn) return null;
                                    return [containerInstanceArn, containerInstance];
                                },
                            ),
                        );

                        const networkInterfaceByInstanceId = new Map(
                            filterMapArray(
                                describeNetworkInterfacesOutput.NetworkInterfaces ?? [],
                                networkInterface => {
                                    const instanceId = networkInterface.Attachment?.InstanceId;
                                    if (!instanceId) return null;
                                    return [instanceId, networkInterface];
                                },
                            ),
                        );

                        return {
                            tasks: describeTasksOutput.tasks ?? [],
                            containerInstanceByArn,
                            networkInterfaceByInstanceId,
                        };
                    })(),
                );

                nextListTasksToken = listTasksOutput.nextToken;
            } while (nextListTasksToken);
        } catch (error) {
            // If an error is thrown while listing tasks, make sure we still wait for our
            // describe task promises.
            await runAllPromises(outputPromises);

            throw error;
        }

        const outputs = await runAllPromises(outputPromises);

        const partitionPlaneByCount = new DefaultMap<
            number,
            {
                partitions: Array<{
                    instances: Array<{
                        isHealthy: boolean;
                        workers: Array<{host: string}>;
                    }>;
                }>;
            }
        >(partitionCount => ({
            partitions: createArrayWithLength(partitionCount, () => ({
                instances: [],
            })),
        }));

        for (const output of outputs) {
            for (const task of output.tasks) {
                const serviceNameTag = task.tags?.find(tag => tag.key === "aws:ecs:serviceName");
                if (!serviceNameTag) {
                    throw new InternalError(
                        "Expected `TaskRealtimeService` ECS tasks to be tagged with the service name",
                    );
                }

                const serviceNameTagMatch = (serviceNameTag.value ?? "").match(
                    /Partition(\d+)Of(\d+)/,
                );
                if (!serviceNameTagMatch) {
                    throw new InternalError(
                        "Expected `TaskRealtimeService` ECS task name to be in the format `Partition{partitionNumber}Of{partitionCount}`",
                    );
                }

                const partitionNumber = parseInt(serviceNameTagMatch[1]!, 10);
                const partitionCount = parseInt(serviceNameTagMatch[2]!, 10);

                assert(1 <= partitionNumber && partitionNumber <= partitionCount);

                // During a deploy, we may have a provisioning ECS task that hasn't been
                // assigned a container yet.
                if (!task.containerInstanceArn) continue;

                const containerInstance = output.containerInstanceByArn.get(
                    task.containerInstanceArn,
                );

                if (!containerInstance) {
                    throw new InternalError(
                        "Couldn't find `TaskRealtimeService` EC2 task's container instance",
                    );
                }

                const registeredResourcesPorts =
                    containerInstance.registeredResources?.find(
                        resource => resource.name === "PORTS",
                    )?.stringSetValue ?? [];

                const remainingResourcesPorts =
                    containerInstance.remainingResources?.find(
                        resource => resource.name === "PORTS",
                    )?.stringSetValue ?? [];

                // `containerInstance.registeredResources` has all the ports registered by AWS
                // itself. `containerInstance.remainingResources` has all the ports registered
                // by AWS and all of our container ports. Removing
                // `containerInstance.registeredResources` from
                // `containerInstance.remainingResources` gives us our container's ports.
                //
                // From [the documentation][1]:
                //
                // > - **registeredResources:** [...] For port resource types, this parameter
                // >   describes the ports that were reserved by the Amazon ECS container agent
                // >   when it registered the container instance with Amazon ECS.
                // > - **remainingResources:** [...] For port resource types, this parameter
                // >   describes the ports that were reserved by the Amazon ECS container agent
                // >   (at instance registration time) and any task containers that have
                // >   reserved port mappings on the host (with the `host` or `bridge` network
                // >   mode). [...]
                //
                // [1]: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerInstance.html
                const portSet = new Set(remainingResourcesPorts);

                for (const registeredResourcesPort of registeredResourcesPorts) {
                    portSet.delete(registeredResourcesPort);
                }

                // We have a small proxy server on port 80 for Cloudflare since Cloudflare can
                // only connect to default ports.
                portSet.delete("80");

                // Make sure port array is sorted so we consistently route to the same worker
                // when picking an index based on `SpaceId`.
                const ports = Array.from(portSet).sort();

                const networkInterface = containerInstance.ec2InstanceId
                    ? output.networkInterfaceByInstanceId.get(containerInstance.ec2InstanceId)
                    : null;

                if (!networkInterface) {
                    throw new InternalError(
                        "Couldn't find `TaskRealtimeService` EC2 task container instance's network interface",
                    );
                }

                // We use the public DNS name since Cloudflare doesn't like directly connecting
                // to IP addresses.
                const publicDnsName = networkInterface.Association?.PublicDnsName;

                if (!publicDnsName) {
                    throw new InternalError(
                        "Couldn't find `TaskRealtimeService` EC2 task container instance network interface's public DNS name",
                    );
                }

                const partitionIndex = partitionNumber - 1;
                const partitionPlane = partitionPlaneByCount.getOrSetDefault(partitionCount);

                partitionPlane.partitions[partitionIndex]!.instances.push({
                    isHealthy: task.healthStatus === "HEALTHY",
                    workers: ports.map(port => ({
                        host: `${publicDnsName}:${port}`,
                    })),
                });
            }
        }

        return {
            partitionPlanes: Array.from(partitionPlaneByCount.values()),
        };
    }
}
