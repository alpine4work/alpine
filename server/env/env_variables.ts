import {assert} from "~/shared/helpers/control/assert";

assert(
    typeof window === "undefined",
    "Env variables are present on the client! This means secrets may have been leaked",
);

type EnvVariables = {
    cookieSessionSecret: string;
    awsRegion: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
};

const getVariablesByEnvironment: {[key: string]: () => EnvVariables} = {
    development: () => ({
        cookieSessionSecret: "secret",
        awsRegion: "us-east-1",
        awsAccessKeyId: "localstack",
        awsSecretAccessKey: "localstack",
    }),
    test: () => ({
        cookieSessionSecret: "secret",
        awsRegion: "us-east-1",
        awsAccessKeyId: "localstack",
        awsSecretAccessKey: "localstack",
    }),
};

assert(process.env.NODE_ENV, "Expected `NODE_ENV` to be set");
const getVariables = getVariablesByEnvironment[process.env.NODE_ENV];
assert(getVariables, "Expected `NODE_ENV` to be set to a valid environment");

const variables = getVariables();

export const {cookieSessionSecret, awsRegion, awsAccessKeyId, awsSecretAccessKey} = variables;
