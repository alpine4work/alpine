import {
    DescribeNetworkInterfacesCommand,
    DescribeNetworkInterfacesCommandOutput,
    EC2Client,
    NetworkInterface,
} from "@aws-sdk/client-ec2";
import {
    ContainerInstance,
    DescribeContainerInstancesCommand,
    DescribeContainerInstancesCommandOutput,
    DescribeTasksCommand,
    DescribeTasksCommandOutput,
    ECSClient,
    ListTasksCommand,
    ListTasksCommandOutput,
    Task,
} from "@aws-sdk/client-ecs";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

/**
 * Route requests to `TaskRealtimeService` by getting information about running EC2
 * instances from [ECS][1].
 *
 * [1]: https://aws.amazon.com/ecs/
 */
export class TaskRealtimeServiceEcsRouter extends TaskRealtimeServiceRouterBase {
    private readonly _ecsClient: ECSClient;
    private readonly _ec2Client: EC2Client;
    private readonly _ecsCluster: string;
    private readonly _ecsTaskDefinitionFamily: string;
    private readonly _securityGroupId: string;

    private constructor({
        region,
        ecsCluster,
        ecsTaskDefinitionFamily,
        securityGroupId,
    }: {
        region: string;
        ecsCluster: string;
        ecsTaskDefinitionFamily: string;
        securityGroupId: string;
    }) {
        super();
        this._ecsClient = new ECSClient({region});
        this._ec2Client = new EC2Client({region});
        this._ecsCluster = ecsCluster;
        this._ecsTaskDefinitionFamily = ecsTaskDefinitionFamily;
        this._securityGroupId = securityGroupId;
    }

    /**
     * Construct a router, load its routes once, and start the background refresh loop.
     * Resolves only after routes are ready, so a service can block startup on it and
     * never route a request before it knows where `TaskRealtimeService` lives.
     * `registerShutdown` is wired to stop the loop on process shutdown.
     */
    public static async new(
        {
            region,
            ecsCluster,
            ecsTaskDefinitionFamily,
            securityGroupId,
        }: {
            region: string;
            ecsCluster: string;
            ecsTaskDefinitionFamily: string;
            securityGroupId: string;
        },
        {
            context,
            registerShutdown,
        }: {
            context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>;
            registerShutdown: (cleanup: () => void) => void;
        },
    ): Promise<TaskRealtimeServiceEcsRouter> {
        const router = new TaskRealtimeServiceEcsRouter({
            region,
            ecsCluster,
            ecsTaskDefinitionFamily,
            securityGroupId,
        });

        await router._getRoutesAndStartRefreshInterval(context, {registerShutdown});

        return router;
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
        const outputs: Array<{
            tasks: Array<Task>;
            containerInstanceByArn: Map<string, ContainerInstance>;
            networkInterfaceByInstanceId: Map<string, NetworkInterface>;
        }> = await parallelMapAsyncIterableToArray(
            this._runListTasks(context),
            async listTasksOutput => {
                const describeTasksOutput = await this._runDescribeTasks(
                    context,
                    listTasksOutput.taskArns ?? [],
                );

                if ((describeTasksOutput.failures?.length ?? 0) > 0) {
                    throw new InternalError("Failed to describe some ECS task(s)");
                }

                const describeContainerInstancesOutput = await this._runDescribeContainerInstances(
                    context,
                    filterMapArray(
                        describeTasksOutput.tasks ?? [],
                        task => task.containerInstanceArn,
                    ),
                );

                if ((describeContainerInstancesOutput.failures?.length ?? 0) > 0) {
                    throw new InternalError("Failed to describe some ECS container instance(s)");
                }

                const describeNetworkInterfacesOutputs = await arrayFromAsyncIterable(
                    this._runDescribeNetworkInterfaces(
                        context,
                        filterMapArray(
                            describeContainerInstancesOutput.containerInstances ?? [],
                            containerInstance => containerInstance.ec2InstanceId,
                        ),
                    ),
                );

                const containerInstanceByArn = new Map(
                    filterMapArray(
                        describeContainerInstancesOutput.containerInstances ?? [],
                        containerInstance => {
                            const {containerInstanceArn} = containerInstance;
                            if (!containerInstanceArn) return;
                            return [containerInstanceArn, containerInstance];
                        },
                    ),
                );

                const networkInterfaceByInstanceId = new Map(
                    flatMapIterable(
                        describeNetworkInterfacesOutputs,
                        describeNetworkInterfacesOutput =>
                            filterMapIterable(
                                describeNetworkInterfacesOutput.NetworkInterfaces ?? [],
                                networkInterface => {
                                    const instanceId = networkInterface.Attachment?.InstanceId;
                                    if (!instanceId) return;
                                    return [instanceId, networkInterface];
                                },
                            ),
                    ),
                );

                return {
                    tasks: describeTasksOutput.tasks ?? [],
                    containerInstanceByArn,
                    networkInterfaceByInstanceId,
                };
            },
        );

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

                // During a deploy, we may have a provisioning ECS task that hasn't been assigned a
                // container yet.
                if (!task.containerInstanceArn) continue;

                const containerInstance = output.containerInstanceByArn.get(
                    task.containerInstanceArn,
                );

                if (!containerInstance) {
                    throw new InternalError(
                        "Couldn\u2019t find `TaskRealtimeService` EC2 task\u2019s container instance",
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
                // itself. `containerInstance.remainingResources` has all the ports registered by
                // AWS and all of our container ports. Removing
                // `containerInstance.registeredResources` from
                // `containerInstance.remainingResources` gives us our container's ports.
                //
                // From [the documentation][1]:
                //
                // > - **registeredResources:** [...] For port resource types, this parameter
                // >   describes the ports that were reserved by the Amazon ECS container agent
                // >   when it registered the container instance with Amazon ECS.
                // > - **remainingResources:** [...] For port resource types, this parameter
                // >   describes the ports that were reserved by the Amazon ECS container agent (at
                // >   instance registration time) and any task containers that have reserved port
                // >   mappings on the host (with the `host` or `bridge` network mode). [...]
                //
                // [1]:
                //     https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerInstance.html
                const portSet = new Set(remainingResourcesPorts);

                for (const registeredResourcesPort of registeredResourcesPorts) {
                    portSet.delete(registeredResourcesPort);
                }

                // We have a small proxy server on port 80 for Cloudflare since Cloudflare can only
                // connect to default ports.
                portSet.delete("80");

                // Make sure port array is sorted so we consistently route to the same worker when
                // picking an index based on `SpaceId`.
                const ports = Array.from(portSet).sort();

                const networkInterface = containerInstance.ec2InstanceId
                    ? output.networkInterfaceByInstanceId.get(containerInstance.ec2InstanceId)
                    : null;

                if (!networkInterface) {
                    throw new InternalError(
                        "Couldn\u2019t find `TaskRealtimeService` EC2 task container instance\u2019s network interface",
                    );
                }

                // We use the public DNS name since Cloudflare doesn't like directly connecting to
                // IP addresses.
                const publicDnsName = networkInterface.Association?.PublicDnsName;

                if (!publicDnsName) {
                    throw new InternalError(
                        "Couldn\u2019t find `TaskRealtimeService` EC2 task container instance network interface\u2019s public DNS name",
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

    private async *_runListTasks(
        context: ServerProcessContext,
    ): AsyncIterableIterator<ListTasksCommandOutput> {
        // `ListTasks` can only return 100 entries at a time and
        // `DescribeTasks`/`DescribeContainerInstances` can only consume 100 entries at a
        // time.
        const maxResults = 100;

        let nextToken: string | undefined;

        do {
            // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ListTasks.html
            const output = await context.tracer.withSpan("ECS ListTasks", async (context, span) => {
                const command = new ListTasksCommand({
                    maxResults,
                    nextToken,
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
            });

            nextToken = output.nextToken;
            yield output;
        } while (nextToken !== undefined);
    }

    private _runDescribeTasks(
        context: ServerProcessContext,
        tasks: Array<string>,
    ): Promise<DescribeTasksCommandOutput> {
        // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html
        return context.tracer.withSpan("ECS DescribeTasks", (context, span) => {
            const command = new DescribeTasksCommand({
                cluster: this._ecsCluster,
                tasks,
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
        });
    }

    private _runDescribeContainerInstances(
        context: ServerProcessContext,
        containerInstances: Array<string>,
    ): Promise<DescribeContainerInstancesCommandOutput> {
        // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeContainerInstances.html
        return context.tracer.withSpan("ECS DescribeContainerInstances", (context, span) => {
            const command = new DescribeContainerInstancesCommand({
                cluster: this._ecsCluster,
                containerInstances,
            });

            span.addData({
                aws: {
                    ecs: {
                        cluster: command.input.cluster,
                        containerInstanceCount: command.input.containerInstances?.length ?? 0,
                    },
                },
            });

            return this._ecsClient.send(command);
        });
    }

    private async *_runDescribeNetworkInterfaces(
        context: ServerProcessContext,
        ec2InstanceIds: Array<string>,
    ): AsyncIterableIterator<DescribeNetworkInterfacesCommandOutput> {
        const maxResults = 100;
        let nextToken: string | undefined;

        do {
            // https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeNetworkInterfaces.html
            const output = await context.tracer.withSpan(
                "EC2 DescribeNetworkInterfaces",
                (context, span) => {
                    const command = new DescribeNetworkInterfacesCommand({
                        MaxResults: maxResults,
                        NextToken: nextToken,
                        Filters: [
                            // It appears that `DescribeNetworkInterfaces` iterates through ALL EC2 network
                            // interfaces in our AWS account. This is inefficient when we have many EC2
                            // instances running. From reading [the documentation][1] it seems like `group-id`
                            // (referencing a security group) is indexed and may speed up our request.
                            //
                            // > If you have a large number of network interfaces, the operation fails unless
                            // > you use pagination or one of the following filters: `group-id`, `mac-address`,
                            // > `private-dns-name`, `private-ip-address`, `subnet-id`, or `vpc-id`.
                            //
                            // So we filter by the security group for `TaskRealtimeService` in addition to the
                            // EC2 instance IDs we're looking for.
                            //
                            // [1]:
                            //     https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeNetworkInterfaces.html
                            {
                                Name: "group-id",
                                Values: [this._securityGroupId],
                            },

                            {
                                Name: "attachment.instance-id",
                                Values: ec2InstanceIds,
                            },
                        ],
                    });

                    span.addData({
                        aws: {
                            ec2: {
                                securityGroupId: this._securityGroupId,
                                instanceCount: ec2InstanceIds.length,
                            },
                        },
                    });

                    return this._ec2Client.send(command);
                },
            );

            nextToken = output.NextToken;
            yield output;
        } while (nextToken !== undefined);
    }
}
