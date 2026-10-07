import crypto from "crypto"

const TOLERANCE_SECONDS = 3 * 60

export type WebhookHeaders = Record<string, string | string[] | undefined>

const header = (headers: WebhookHeaders, name: string): string | undefined => {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
  const value = key ? headers[key] : undefined
  return Array.isArray(value) ? value[0] : value
}

/**
 * Verifies a Yoco webhook (https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events).
 * Signed content is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with the
 * base64-decoded secret (after the `whsec_` prefix). The `webhook-signature` header holds
 * space-separated `v1,<base64>` entries; any match is accepted.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
  now: number = Date.now()
): boolean {
  const id = header(headers, "webhook-id")
  const timestamp = header(headers, "webhook-timestamp")
  const signatures = header(headers, "webhook-signature")
  if (!id || !timestamp || !signatures || !secret) {
    return false
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) {
    return false
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest()

  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",")
    if (version !== "v1" || !signature) return false
    const actual = Buffer.from(signature, "base64")
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  })
}
