export function classifyProvider(urlLike) {
  const value = String(urlLike || "").toLowerCase();
  if (value.includes("graph.facebook.com") && value.includes("whatsapp")) {
    return { provider: "whatsapp_business_api", operation: "request" };
  }
  if (value.includes("api.twilio.com")) {
    return { provider: "twilio", operation: "request" };
  }
  if (value.includes("api.openai.com")) {
    return { provider: "openai", operation: "request" };
  }
  if (value.includes("api.deepgram.com")) {
    return { provider: "deepgram", operation: "request" };
  }
  if (value.includes("generativelanguage.googleapis.com")) {
    return { provider: "google_gemini", operation: "request" };
  }
  if (value.includes("firestore.googleapis.com")) {
    return { provider: "firebase_firestore", operation: "request" };
  }
  if (value.includes("firebasedatabase.app") || value.includes("firebaseio.com")) {
    return { provider: "firebase_rtdb", operation: "request" };
  }
  if (value.includes("storage.googleapis.com")) {
    return { provider: "google_cloud_storage", operation: "request" };
  }
  if (value.includes("bigquery.googleapis.com")) {
    return { provider: "google_bigquery", operation: "request" };
  }
  if (value.includes("dynamodb.") && value.includes(".amazonaws.com")) {
    return { provider: "aws_dynamodb", operation: "request" };
  }
  if (value.includes("cognito-idp.") && value.includes(".amazonaws.com")) {
    return { provider: "aws_cognito", operation: "request" };
  }
  if (
    value.includes("oauth2.googleapis.com") ||
    value.includes("accounts.google.com/o/oauth2") ||
    value.includes("www.googleapis.com/oauth2/")
  ) {
    return { provider: "google_oauth", operation: "request" };
  }
  if (value.includes("www.googleapis.com/drive/") || value.includes("www.googleapis.com/upload/drive/")) {
    return { provider: "google_drive_api", operation: "request" };
  }
  if (value.includes("www.googleapis.com/calendar/")) {
    return { provider: "google_calendar_api", operation: "request" };
  }
  if (value.includes("www.googleapis.com/gmail/")) {
    return { provider: "gmail_api", operation: "request" };
  }
  if (value.includes("sheets.googleapis.com") || value.includes("www.googleapis.com/sheets/")) {
    return { provider: "google_sheets_api", operation: "request" };
  }
  if (value.includes("platform.halo.africa")) {
    return { provider: "vps_platform_api", operation: "request" };
  }
  if (value.includes("functions") && value.includes("halo")) {
    return { provider: "halo_functions_api", operation: "request" };
  }
  return { provider: "external_http", operation: "request" };
}

/** @deprecated use classifyProvider */
export const classifyServiceFromUrl = classifyProvider;

export function inferGoogleServiceFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (value.includes("/drive/")) return { provider: "google_drive_api", operation: "request" };
  if (value.includes("/calendar/")) return { provider: "google_calendar_api", operation: "request" };
  if (value.includes("/gmail/")) return { provider: "gmail_api", operation: "request" };
  if (value.includes("/spreadsheets/")) return { provider: "google_sheets_api", operation: "request" };
  if (value.includes("oauth2")) return { provider: "google_oauth", operation: "request" };
  return { provider: "google_api", operation: "request" };
}

export function inferAwsProvider(clientName) {
  const name = String(clientName || "").toLowerCase();
  if (name.includes("dynamo")) return "aws_dynamodb";
  if (name.includes("cognito")) return "aws_cognito";
  if (name.includes("s3")) return "aws_s3";
  return "aws_sdk";
}

export function isTelemetryEndpointCall(state, urlLike) {
  if (!urlLike || typeof urlLike !== "string") {
    return false;
  }

  try {
    const target = new URL(urlLike, state.config.endpoint);
    const ingest = new URL(state.config.endpoint);
    return target.origin === ingest.origin && target.pathname.startsWith("/v1/events");
  } catch {
    return false;
  }
}
