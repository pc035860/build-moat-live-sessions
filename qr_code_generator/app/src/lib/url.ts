import { ValidationError } from "./errors";

export const BLOCKED_DOMAINS: ReadonlySet<string> = new Set([
  "evil.com",
  "malware.example.com",
  "phishing.example.com",
]);

const MAX_URL_LENGTH = 2048;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function uppercasePercentEncoding(input: string): string {
  return input.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => `%${hex.toUpperCase()}`);
}

export function normalizeUrl(input: string): string {
  const parsed = new URL(input);
  // `URL` already lowercases protocol + hostname and drops default ports for known schemes.
  // We only need to uppercase percent-encoding in the rendered string.
  return uppercasePercentEncoding(parsed.toString());
}

export function validateUrl(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new ValidationError("URL is required");
  }
  if (input.length > MAX_URL_LENGTH) {
    throw new ValidationError(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters`);
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ValidationError("URL is not parseable");
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError(`Unsupported scheme: ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_DOMAINS.has(host)) {
    throw new ValidationError(`Host is blocked: ${host}`);
  }

  return uppercasePercentEncoding(parsed.toString());
}
