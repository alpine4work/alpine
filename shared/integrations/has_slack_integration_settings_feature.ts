// TODO (#slack-integration) Update this to allow the Alpine space in prod.
export const hasSlackIntegrationSettingsFeature = () => {
    return process.env.NODE_ENV !== "production";
};
