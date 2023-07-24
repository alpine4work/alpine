export async function onRequest({request, env}) {
    const airtableApiKey = env.AIRTABLE_API_KEY;

    if (!airtableApiKey) {
        // eslint-disable-next-line no-console
        console.error("Missing Airtable API key");

        return new Response("500 Internal Server Error", {
            status: 500,
            headers: {"Content-Type": "text/plain"},
        });
    }

    const formData = await request.formData();
    const email = formData.get("email");

    if (!email) {
        return new Response("400 Bad Request", {
            status: 400,
            headers: {"Content-Type": "text/plain"},
        });
    }

    // eslint-disable-next-line no-global-fetch
    const response = await fetch("https://api.airtable.com/v0/appZHJ6FvQtDDHAdL/Emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${airtableApiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            records: [{fields: {Email: email}}],
        }),
    });

    if (response.status !== 200) {
        // eslint-disable-next-line no-console
        console.error(
            `Airtable API request failed with status code: ${response.status}`,
            JSON.stringify(await response.json(), null, 2),
        );

        return new Response("500 Internal Server Error", {
            status: 500,
            headers: {"Content-Type": "text/plain"},
        });
    }

    return Response.redirect(new URL("/?registered", request.url), 302);
}
