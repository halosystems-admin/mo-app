#!/usr/bin/env node

const DEFAULT_ENDPOINT = "https://telemetry.halomedical.ai";

function parseArgs(argv) {
  const options = {
    endpoint: process.env.HALO_TELEMETRY_URL || DEFAULT_ENDPOINT,
    token: process.env.HALO_TELEMETRY_TOKEN || "",
    appName: process.env.HALO_TELEMETRY_APP_NAME || "telemetry-verify"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      options.endpoint = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--token") {
      options.token = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--app-name") {
      options.appName = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: halo-telemetry-verify [options]

Verify connectivity to a HALO telemetry endpoint.

Options:
  --endpoint <url>   Telemetry base URL (default: ${DEFAULT_ENDPOINT})
  --token <token>    Practice bearer token (or HALO_TELEMETRY_TOKEN)
  --app-name <name>  App name for the probe event (default: telemetry-verify)

Environment:
  HALO_TELEMETRY_URL
  HALO_TELEMETRY_TOKEN
  HALO_TELEMETRY_APP_NAME
`);
}

async function verifyTelemetry({ endpoint, token, appName }) {
  const baseUrl = endpoint.replace(/\/+$/, "");

  if (!token) {
    throw new Error("Missing token. Pass --token or set HALO_TELEMETRY_TOKEN.");
  }

  const healthResponse = await fetch(`${baseUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Health check failed with HTTP ${healthResponse.status}`);
  }

  const healthBody = await healthResponse.json();
  if (healthBody?.ok !== true) {
    throw new Error("Health check returned unexpected payload");
  }

  const ingestResponse = await fetch(`${baseUrl}/v1/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      app_name: appName,
      raw_payload: {
        type: "telemetry.verify",
        source: "halo-telemetry-verify",
        checked_at: new Date().toISOString()
      }
    })
  });

  if (ingestResponse.status === 401) {
    throw new Error("Ingest rejected token (401). Request a practice token from platform ops.");
  }

  if (!ingestResponse.ok) {
    const details = await ingestResponse.text();
    throw new Error(`Ingest failed with HTTP ${ingestResponse.status}: ${details}`);
  }

  const ingestBody = await ingestResponse.json();
  if (!ingestBody?.event_id) {
    throw new Error("Ingest succeeded but response did not include event_id");
  }

  return {
    endpoint: baseUrl,
    appName,
    eventId: ingestBody.event_id,
    status: ingestBody.status || "accepted"
  };
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

try {
  const result = await verifyTelemetry(options);
  console.log("Telemetry verify OK");
  console.log(`  endpoint: ${result.endpoint}`);
  console.log(`  app_name: ${result.appName}`);
  console.log(`  event_id: ${result.eventId}`);
  console.log(`  status:   ${result.status}`);
} catch (error) {
  console.error(`Telemetry verify failed: ${error.message}`);
  process.exit(1);
}
