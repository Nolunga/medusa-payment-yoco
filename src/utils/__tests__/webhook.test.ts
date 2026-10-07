import crypto from "crypto"
import { verifyWebhookSignature } from "../webhook"
import { fromCents, toCents } from "../money"

const SECRET = "whsec_" + Buffer.from("test-secret-bytes").toString("base64")

/** Independently signs a body the way Yoco does, returning request headers. */
const sign = (body: string, { secret = SECRET, id = "msg_1", timestamp = Math.floor(Date.now() / 1000) } = {}) => {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  const sig = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${sig}` }
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ type: "payment.succeeded" })

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true)
  })

  it("accepts a Buffer body and upper-case header names", () => {
    const h = sign(body)
    const upper = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toUpperCase(), v]))
    expect(verifyWebhookSignature(Buffer.from(body), upper, SECRET)).toBe(true)
  })

  it("accepts any matching entry in a multi-signature header", () => {
    const h = sign(body)
    expect(verifyWebhookSignature(body, { ...h, "webhook-signature": `v1,AAAA ${h["webhook-signature"]}` }, SECRET)).toBe(true)
  })

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body.replace("succeeded", "failed"), sign(body), SECRET)).toBe(false)
  })

  it("rejects a signature made with another secret", () => {
    const other = "whsec_" + Buffer.from("other").toString("base64")
    expect(verifyWebhookSignature(body, sign(body, { secret: other }), SECRET)).toBe(false)
  })

  it("rejects missing headers and an empty secret", () => {
    expect(verifyWebhookSignature(body, {}, SECRET)).toBe(false)
    expect(verifyWebhookSignature(body, sign(body), "")).toBe(false)
  })

  it("rejects timestamps outside the 3 minute tolerance", () => {
    const old = Math.floor(Date.now() / 1000) - 4 * 60
    expect(verifyWebhookSignature(body, sign(body, { timestamp: old }), SECRET)).toBe(false)
  })

  it("rejects unknown signature versions", () => {
    const h = sign(body)
    expect(verifyWebhookSignature(body, { ...h, "webhook-signature": h["webhook-signature"].replace("v1", "v2") }, SECRET)).toBe(false)
  })
})

describe("money", () => {
  it("converts major units to cents without float drift", () => {
    expect(toCents(270.85)).toBe(27085)
    expect(toCents("2")).toBe(200)
    expect(toCents(0.29)).toBe(29)
    expect(fromCents(27085)).toBe(270.85)
  })
})
