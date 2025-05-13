import {CustomResource, Duration} from "aws-cdk-lib";
import {
    EbsDeviceVolumeType,
    IConnectable,
    Port,
    SecurityGroup,
    SubnetType,
} from "aws-cdk-lib/aws-ec2";
import {Effect, IRole, Policy, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import {Domain, EngineVersion} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {crawlOpensearchIndexes} from "~/admin/crawl/crawl.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {OpensearchServerlessCollectionType} from "~/server/opensearch/opensearch_index.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {convertKebabCaseToPascalCase} from "~/shared/helpers/string/convert_kebab_case_to_pascal_case.js";
import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

const opensearchDeployScriptLambdaRelativePath =
    process.env.CDK_LITE === "true"
        ? "cyberworlds/admin/aws/empty_lambda"
        : "cyberworlds/admin/opensearch/deploy_script/deploy_script";

const opensearchDeployScriptLambdaPath = joinPath(
    runfilesPath,
    `${opensearchDeployScriptLambdaRelativePath}.zip`,
);

const opensearchDeployScriptLambdaHandler = `${opensearchDeployScriptLambdaRelativePath}.handler`;

function getSha256Hash(string: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(string);
    return hash.digest("hex");
}

export class AwsOpensearch {
    private readonly _vpcEndpointSecurityGroup: SecurityGroup;
    private readonly _collectionByServerlessCollectionType: Readonly<
        Record<
            OpensearchServerlessCollectionType,
            {
                readonly collection: AwsOpensearchServerlessCollection;
                readonly indexNames: ReadonlyArray<string>;
            }
        >
    >;

    private constructor(
        vpcEndpointSecurityGroup: SecurityGroup,
        collectionByServerlessCollectionType: Readonly<
            Record<
                OpensearchServerlessCollectionType,
                {
                    readonly collection: AwsOpensearchServerlessCollection;
                    readonly indexNames: ReadonlyArray<string>;
                }
            >
        >,
    ) {
        this._vpcEndpointSecurityGroup = vpcEndpointSecurityGroup;
        this._collectionByServerlessCollectionType = collectionByServerlessCollectionType;
    }

    public static async new(parentConstruct: Construct, vpc: AwsVpc) {
        const construct = new Construct(parentConstruct, "Opensearch");

        const indexes = await crawlOpensearchIndexes();
        const indexesHash = getSha256Hash(JSON.stringify(indexes.map(index => index.config)));

        new Domain(parentConstruct, "Domain", {
            vpc,
            // Only allow traffic to/from OpenSearch within our subnet.
            vpcSubnets: [{subnetType: SubnetType.PRIVATE_ISOLATED}],
            domainName: "cyberworlds-search",
            version: EngineVersion.openSearch("2.19"),
            enforceHttps: true,
            enableVersionUpgrade: true,
            encryptionAtRest: {enabled: true},
            nodeToNodeEncryption: true,
            capacity: {
                masterNodes: 3,
                masterNodeInstanceType: "m7g.medium.search",
                dataNodes: 2,
                dataNodeInstanceType: "m7g.large.search",
            },
            ebs: {
                volumeType: EbsDeviceVolumeType.GP3,
                volumeSize: 60,
            },
            zoneAwareness: {
                enabled: true,
                availabilityZoneCount: 2,
            },
            logging: {
                slowSearchLogEnabled: true,
                slowIndexLogEnabled: true,
                appLogEnabled: true,
            },
        });

        const collectionByServerlessCollectionType: Record<
            OpensearchServerlessCollectionType,
            {
                readonly collection: AwsOpensearchServerlessCollection;
                readonly indexNames: ReadonlyArray<string>;
            }
        > = {
            Search: {
                collection: new AwsOpensearchServerlessCollection(construct, "SearchCollection", {
                    name: "search",
                    type: "SEARCH",
                }),
                indexNames: filterMapArray(indexes, index =>
                    index.serverlessCollectionType === "Search" ? index.name : undefined,
                ),
            },
            VectorSearch: {
                collection: new AwsOpensearchServerlessCollection(
                    construct,
                    "VectorSearchCollection",
                    {
                        name: "vector-search",
                        type: "VECTORSEARCH",
                    },
                ),
                indexNames: filterMapArray(indexes, index =>
                    index.serverlessCollectionType === "VectorSearch" ? index.name : undefined,
                ),
            },
        };

        const vpcEndpointSecurityGroup = new SecurityGroup(construct, "VpcEndpointSecurityGroup", {
            vpc,
        });

        new opensearchserverless.CfnVpcEndpoint(construct, "VpcEndpoint", {
            name: "vpc",
            vpcId: vpc.vpcId,
            subnetIds: vpc.selectSubnets().subnetIds,
            securityGroupIds: [vpcEndpointSecurityGroup.securityGroupId],
        });

        // OpenSearch deploy script:
        //
        // NOTE(calebmer): We doesn't use the [CloudFormation
        // `AWS::OpenSearchServerless::Index` resource][1] because that resource
        // provides very little mappings/settings configuration options. Instead we
        // have a custom CloudFormation resource that runs an AWS lambda deploy script.
        //
        // [1]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-opensearchserverless-index.html
        {
            // NOTE(calebmer): We instantiate a `LambdaFunction` directly instead of using
            // `NodejsLambda` since we bundle the code ourselves.
            const deployScript = new LambdaFunction(construct, "DeployScript", {
                code: Code.fromAsset(opensearchDeployScriptLambdaPath),
                handler: opensearchDeployScriptLambdaHandler,
                vpc,
                vpcSubnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
                timeout: Duration.seconds(60),
                // TODO(calebmer): Node.js v20 is not currently supported as an AWS lambda
                // runtime.
                // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
                runtime: Runtime.NODEJS_18_X,
                environment: {
                    OPENSEARCH_SEARCH_SERVERLESS_COLLECTION_ENDPOINT:
                        collectionByServerlessCollectionType.Search.collection.collectionEndpoint,
                    OPENSEARCH_VECTOR_SEARCH_SERVERLESS_COLLECTION_ENDPOINT:
                        collectionByServerlessCollectionType.VectorSearch.collection
                            .collectionEndpoint,
                },
                // Don't retain deploy script logs forever.
                logRetention: RetentionDays.ONE_MONTH,
            });

            vpcEndpointSecurityGroup.connections.allowFrom(deployScript, Port.tcp(443));

            const deployScriptProvider = new Provider(construct, "DeployScriptProvider", {
                onEventHandler: deployScript,
            });

            const deployScriptResource = new CustomResource(construct, "DeployScriptResource", {
                serviceToken: deployScriptProvider.serviceToken,
                properties: {
                    // Re-run our deploy script whenever the config for an OpenSearch index changes.
                    // The script should be idempotent so will not change any previously deployed
                    // OpenSearch indexes.
                    indexesHash,
                },
            });

            for (const {collection} of Object.values(collectionByServerlessCollectionType)) {
                collection.addDeployScriptAccessPolicy(
                    `DeployScript${convertKebabCaseToPascalCase(
                        collection.collectionName,
                    )}AccessPolicy`,
                    assertExists(deployScript.role),
                );

                // The `collection` must be created before the resource runs.
                deployScriptResource.node.addDependency(collection);
            }
        }

        return new AwsOpensearch(vpcEndpointSecurityGroup, collectionByServerlessCollectionType);
    }

    public get searchServerlessCollectionEndpoint() {
        return this._collectionByServerlessCollectionType.Search.collection.collectionEndpoint;
    }

    public get vectorSearchServerlessCollectionEndpoint() {
        return this._collectionByServerlessCollectionType.VectorSearch.collection
            .collectionEndpoint;
    }

    public allowConnectionsFrom(other: IConnectable) {
        this._vpcEndpointSecurityGroup.connections.allowFrom(other, Port.tcp(443));
    }

    /**
     * Add an access policy granting read/write access to all OpenSearch indexes.
     * OpenSearch Serverless needs to create non-IAM data access policy rules which
     * is why this needs an `id` for a new construct instead of following a
     * `grant()` pattern that only adds to an IAM policy.
     */
    public addReadWriteAccessPolicy(id: string, role: IRole) {
        // Enforce convention that all access policy `id`s end with `AccessPolicy`.
        assert(id.endsWith("AccessPolicy"));

        for (const {collection, indexNames} of Object.values(
            this._collectionByServerlessCollectionType,
        )) {
            collection.addIndexReadWriteAccessPolicy(
                `${id.slice(0, -"AccessPolicy".length)}${convertKebabCaseToPascalCase(
                    collection.collectionName,
                )}AccessPolicy`,
                role,
                indexNames,
            );
        }
    }
}

/**
 * There are [no official OpenSearch serverless L2 constructs][1]. This class
 * is our own L2 construct using the low-level L1 OpenSearch serverless
 * constructs. See the [AWS CloudFormation documentation for these
 * constructs][2].
 *
 * This class is based on examples in the GitHub repo
 * [`aws-samples/opensearch-serverless-common-usage-patterns`][3].
 *
 * [1]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchserverless-readme.html
 * [2]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-opensearchserverless-collection.html
 * [3]: https://github.com/aws-samples/opensearch-serverless-common-usage-patterns
 */
class AwsOpensearchServerlessCollection extends Construct {
    private readonly _collection: opensearchserverless.CfnCollection;
    private readonly _accessPolicyNames = new Set<string>();

    constructor(
        parentConstruct: Construct,
        id: string,
        {name, type = "SEARCH"}: {name: string; type?: "SEARCH" | "VECTORSEARCH"},
    ) {
        super(parentConstruct, id);

        const networkSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(
            this,
            "NetworkSecurityPolicy",
            {
                name: `${name}-network`,
                type: "network",
                policy: JSON.stringify([
                    {
                        // We allow collections to be accessed from the public internet (similar to how
                        // DynamoDB is accessible from the public internet). However, you still need
                        // appropriate IAM roles to access data within OpenSearch.
                        //
                        // Public internet access is convenient for OpenSearch dashboard access by
                        // system administrators when investigating a bug.
                        //
                        // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-network.html
                        AllowFromPublic: true,
                        Rules: [
                            {ResourceType: "dashboard", Resource: [`collection/${name}`]},
                            {ResourceType: "collection", Resource: [`collection/${name}`]},
                        ],
                    },
                ]),
            },
        );

        const encryptionSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(
            this,
            "EncryptionSecurityPolicy",
            {
                name: `${name}-encryption`,
                type: "encryption",
                policy: JSON.stringify({
                    AWSOwnedKey: true,
                    Rules: [
                        {
                            ResourceType: "collection",
                            Resource: [`collection/${name}`],
                        },
                    ],
                }),
            },
        );

        this._collection = new opensearchserverless.CfnCollection(this, "Collection", {
            name,
            type,
            standbyReplicas: "ENABLED",
        });

        this._collection.addDependency(networkSecurityPolicy);
        this._collection.addDependency(encryptionSecurityPolicy);

        // Make sure our names don't exceed the maximum length.
        assert(networkSecurityPolicy.name.length <= 32);
        assert(encryptionSecurityPolicy.name.length <= 32);
        assert(3 <= this._collection.name.length && this._collection.name.length <= 32);
    }

    public get collectionName() {
        return this._collection.name;
    }

    public get collectionEndpoint() {
        return this._collection.attrCollectionEndpoint;
    }

    /**
     * Add an access policy for our deploy script. The deploy script gets full
     * access to OpenSearch so it can write and update indexes as needed.
     */
    public addDeployScriptAccessPolicy(id: string, role: IRole) {
        const name = convertPascalCaseToKebabCase(
            id.endsWith("AccessPolicy") ? id.slice(0, -"AccessPolicy".length) : id,
        ).slice(0, 32);

        assert(!this._accessPolicyNames.has(name));
        this._accessPolicyNames.add(name);

        const accessPolicy = new opensearchserverless.CfnAccessPolicy(this, id, {
            name,
            type: "data",
            policy: JSON.stringify([
                {
                    Principal: [role.roleArn],
                    Rules: [
                        {
                            ResourceType: "collection",
                            Resource: [`collection/${this._collection.name}`],
                            Permission: ["aoss:*"],
                        },
                        {
                            ResourceType: "index",
                            Resource: [`index/${this._collection.name}/*`],
                            Permission: ["aoss:*"],
                        },
                    ],
                },
            ]),
        });

        accessPolicy.addDependency(this._collection);

        // It's not enough to add data access policies. We must also grant API access
        // through IAM or else the user will get 403 forbidden errors.
        //
        // > Being granted permissions within a data access policy is not sufficient to
        // > access data in your OpenSearch Serverless collection. An associated
        // > principal must also be granted access to the IAM permissions
        // > `aoss:APIAccessAll` and `aoss:DashboardsAccessAll`. Both permissions grant
        // > full access to collection resources, while the Dashboards permission also
        // > provides access to OpenSearch Dashboards. If a principal doesn't have both
        // > of these IAM permissions, they will receive 403 errors when attempting to
        // > send requests to the collection.
        //
        // ([Source][1])
        //
        // [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-data-access.html
        const accessPolicyPolicy = new Policy(this, `${id}Policy`, {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    resources: [this._collection.attrArn],
                    actions: ["aoss:APIAccessAll", "aoss:DashboardsAccessAll"],
                }),
            ],
        });

        accessPolicyPolicy.node.addDependency(accessPolicy);
        role.attachInlinePolicy(accessPolicyPolicy);
    }

    /**
     * Add an access policy that gives read/write access to the documents in the
     * provided indexes. Doesn't give access to reading/writing settings on the
     * index itself. Only documents within the index.
     */
    public addIndexReadWriteAccessPolicy(
        id: string,
        role: IRole,
        indexNames: ReadonlyArray<string>,
    ) {
        const name = convertPascalCaseToKebabCase(
            id.endsWith("AccessPolicy") ? id.slice(0, -"AccessPolicy".length) : id,
        ).slice(0, 32);

        assert(!this._accessPolicyNames.has(name));
        this._accessPolicyNames.add(name);

        const accessPolicy = new opensearchserverless.CfnAccessPolicy(this, id, {
            name,
            type: "data",
            policy: JSON.stringify([
                {
                    Principal: [role.roleArn],
                    Rules: [
                        {
                            ResourceType: "index",
                            Resource: indexNames.map(indexName => {
                                // Don't allow wildcard in `indexName`.
                                assert(isIdentifier(indexName));

                                return `index/${this._collection.name}/${indexName}`;
                            }),
                            Permission: ["aoss:WriteDocument", "aoss:ReadDocument"],
                        },
                    ],
                },
            ]),
        });

        accessPolicy.addDependency(this._collection);

        // It's not enough to add data access policies. We must also grant API access
        // through IAM or else the user will get 403 forbidden errors.
        //
        // > Being granted permissions within a data access policy is not sufficient to
        // > access data in your OpenSearch Serverless collection. An associated
        // > principal must also be granted access to the IAM permissions
        // > `aoss:APIAccessAll` and `aoss:DashboardsAccessAll`. Both permissions grant
        // > full access to collection resources, while the Dashboards permission also
        // > provides access to OpenSearch Dashboards. If a principal doesn't have both
        // > of these IAM permissions, they will receive 403 errors when attempting to
        // > send requests to the collection.
        //
        // ([Source][1])
        //
        // [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-data-access.html
        const accessPolicyPolicy = new Policy(this, `${id}Policy`, {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    resources: [this._collection.attrArn],
                    actions: ["aoss:APIAccessAll"],
                }),
            ],
        });

        accessPolicyPolicy.node.addDependency(accessPolicy);
        role.attachInlinePolicy(accessPolicyPolicy);
    }
}
