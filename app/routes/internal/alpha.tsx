import {ReactNode, useMemo, useState} from "react";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Spacer} from "~/client/design/spacer";
import {TextInput} from "~/client/design/text_input";
import {useLoaderDataWithSchema} from "~/client/helpers/use_loader_data_with_schema";
import {
    getAlphaConfiguration,
    getUndecidedAlphaAccessRequests,
} from "~/server/dynamo/alpha_access_table";
import {jsonWithSchema} from "~/server/helpers/json_with_schema";
import {DataFunctionArgs} from "~/server/helpers/types/remix_data_function_args";
import {AlphaAccessRequestModel} from "~/shared/alpha/alpha_access_request_model";
import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema";
import {InvalidArgumentError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {Id, isId} from "~/shared/id/id";
import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/shared/network/alpha_network_definition";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: "Closed Alpha Management - Cyberworlds",
    };
}

const LoaderSchema = Schema.object({
    configuration: AlphaConfigurationSchema,
    requests: Schema.array(AlphaAccessRequestModel.schema()),
});

export async function loader({context}: DataFunctionArgs) {
    const [configuration, requests] = await runAllPromises([
        getAlphaConfiguration(context),
        getUndecidedAlphaAccessRequests(await context.authenticate()),
    ]);
    return jsonWithSchema(LoaderSchema, {configuration, requests});
}

export default function AlphaManagementPage() {
    const {configuration, requests: loadedRequests} = useLoaderDataWithSchema(LoaderSchema);

    const dateTimeFormatter = useMemo(() => {
        return new Intl.DateTimeFormat("default", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        });
    }, []);

    const [decidedEmailAddresses, setDecidedEmailAddresses] = useState<ReadonlySet<string>>(
        new Set(),
    );

    const requests = loadedRequests.filter(
        request => !decidedEmailAddresses.has(request.emailAddress),
    );

    const [defaultSpaceId, setAddAccountsToSpaceId] = useState(configuration.defaultSpaceId ?? "");
    const [authenticatedHomeUrl, setAuthenticatedHomeUrl] = useState(
        configuration.authenticatedHomeUrl ?? "",
    );

    return (
        <Box display="flex" justifyContent="center">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "4",
                    paddingY: "6",
                })}
            >
                <h1
                    className={sprinkles({
                        typographySize: "heading4",
                        typographyStyle: "primarySemiBold",
                    })}
                >
                    Closed Alpha Management
                </h1>
                <Box>
                    <Spacer space="3" />
                    <TextInput
                        label="Space ID to add new accounts to"
                        value={defaultSpaceId}
                        onChange={setAddAccountsToSpaceId}
                        typographyStyle="code"
                    />
                    <Spacer space="3" />
                    <TextInput
                        label="URL to redirect accounts after signing in"
                        value={authenticatedHomeUrl}
                        onChange={setAuthenticatedHomeUrl}
                        typographyStyle="code"
                    />
                    <Spacer space="3" />
                    <Box display="flex" justifyContent="flex-end">
                        <Button
                            variant="accent"
                            onPress={async () => {
                                let validatedAddAccountsToSpaceId: Id | undefined;
                                if (defaultSpaceId.length > 0) {
                                    if (!isId(defaultSpaceId))
                                        throw new InvalidArgumentError(
                                            'Expected "defaultSpaceId" to be an ID',
                                        );
                                    validatedAddAccountsToSpaceId = defaultSpaceId;
                                }

                                await saveAlphaConfiguration({
                                    configuration: {
                                        defaultSpaceId: validatedAddAccountsToSpaceId,
                                        authenticatedHomeUrl:
                                            authenticatedHomeUrl.length > 0
                                                ? authenticatedHomeUrl
                                                : undefined,
                                    },
                                });
                            }}
                        >
                            Save
                        </Button>
                    </Box>
                </Box>
                <Spacer space="12" />
                <Box borderTop="grey-10" />
                <Spacer space="12" />
                <Box>
                    <Box typographySize="heading5" typographyStyle="primarySemiBold">
                        Access Requests
                    </Box>
                    <Spacer space="3" />
                    {requests.length === 0 && <Box color="grey-80">No alpha access requests</Box>}
                    <Box display="flex" flexDirection="column" gap="3">
                        {requests.map(request => (
                            <AlphaAccessRequest
                                key={request.emailAddress}
                                request={request}
                                dateTimeFormatter={dateTimeFormatter}
                                onDecided={() =>
                                    setDecidedEmailAddresses(decidedEmailAddresses =>
                                        new Set(decidedEmailAddresses).add(request.emailAddress),
                                    )
                                }
                            />
                        ))}
                    </Box>
                </Box>
            </main>
        </Box>
    );
}

function AlphaAccessRequest({
    request,
    dateTimeFormatter,
    onDecided,
}: {
    request: AlphaAccessRequestModel;
    dateTimeFormatter: Intl.DateTimeFormat;
    onDecided: () => void;
}) {
    return (
        <Box padding="3" borderRadius="base" border="grey-10">
            <Box marginBottom="3" paddingBottom="3" borderBottom="grey-10" display="flex" gap="2">
                <Box
                    flexGrow="1"
                    typographyStyle="primarySemiBold"
                    typographySize="heading5"
                    userSelect="text"
                >
                    {request.emailAddress}
                </Box>
                <Button
                    variant="quiet"
                    onPress={async () => {
                        await denyAlphaAccessRequest({emailAddress: request.emailAddress});
                        onDecided();
                    }}
                >
                    Deny
                </Button>
                <Button
                    variant="accent"
                    onPress={async () => {
                        await approveAlphaAccessRequest({emailAddress: request.emailAddress});
                        onDecided();
                    }}
                >
                    Approve
                </Button>
            </Box>
            <Box display="flex" flexDirection="column" gap="2">
                <AlphaAccessRequestField
                    label="Requested"
                    value={dateTimeFormatter.format(request.createdTime)}
                />
                <AlphaAccessRequestField label="Name" value={request.name} />
                <AlphaAccessRequestField
                    label="Message"
                    value={
                        request.message.length !== 0
                            ? request.message
                                  .split("\n")
                                  .flatMap((message, i) =>
                                      i === 0 ? [message] : [<br key={i} />, message],
                                  )
                            : "\u2013"
                    }
                />
            </Box>
        </Box>
    );
}

function AlphaAccessRequestField({label, value}: {label: string; value: ReactNode}) {
    return (
        <Box display="flex" gap="2">
            <Box flexShrink="0" width="16" color="grey-60">
                {label}
            </Box>
            <Box flexGrow="1" userSelect="text">
                {value}
            </Box>
        </Box>
    );
}
