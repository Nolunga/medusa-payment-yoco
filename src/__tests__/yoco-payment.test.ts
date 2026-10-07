import YocoPaymentService from "../services/yoco-payment"
import { YocoOptionsSchema, YocoPaymentError, YocoErrorCode } from "../types"

describe("YocoPaymentService", () => {
  let service: YocoPaymentService
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("Configuration Validation", () => {
    it("should validate secretKey format", () => {
      const invalidConfig = {
        secretKey: "invalid_key",
      }

      const result = YocoOptionsSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it("should accept valid test secret key", () => {
      const validConfig = {
        secretKey: "sk_test_1234567890",
        debug: false,
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it("should accept valid live secret key", () => {
      const validConfig = {
        secretKey: "sk_live_1234567890",
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it("should validate redirect URLs", () => {
      const invalidConfig = {
        secretKey: "sk_test_1234567890",
        successUrl: "not-a-url",
      }

      const result = YocoOptionsSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it("should accept valid redirect URLs", () => {
      const validConfig = {
        secretKey: "sk_test_1234567890",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        failureUrl: "https://example.com/failure",
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })
  })

  describe("Service Initialization", () => {
    it("should throw error for invalid configuration", () => {
      expect(() => {
        new YocoPaymentService({ logger: mockLogger }, { secretKey: "invalid" } as any)
      }).toThrow("Configuration validation failed")
    })

    it("should initialize with valid configuration", () => {
      const service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: true,
      })

      expect(service).toBeDefined()
      expect(mockLogger.info).toHaveBeenCalledWith("[Yoco] Initialized with validated configuration")
    })
  })

  describe("YocoPaymentError", () => {
    it("should create error from Yoco API error", () => {
      const yocoError = {
        errorCode: "card_declined",
        errorMessage: "Card was declined",
        displayMessage: "Your card was declined",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error).toBeInstanceOf(YocoPaymentError)
      expect(error.message).toBe("Your card was declined")
      expect(error.code).toBe(YocoErrorCode.CARD_DECLINED)
    })

    it("should map unknown error codes to API_ERROR", () => {
      const yocoError = {
        errorCode: "unknown_error",
        errorMessage: "Something went wrong",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error.code).toBe(YocoErrorCode.API_ERROR)
    })

    it("should handle missing displayMessage", () => {
      const yocoError = {
        errorCode: "processing_error",
        errorMessage: "Processing failed",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error.message).toBe("Processing failed")
    })
  })

  describe("Payment Amount Validation", () => {
    beforeEach(() => {
      service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: false,
      })

      // Mock the API method
      ;(service as any).api = jest.fn()
    })

    it("should reject amounts below minimum", async () => {
      const input = {
        amount: 1, // R1.00 - below minimum
        currency_code: "ZAR",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Minimum amount is R2.00")
    })

    it("should reject non-ZAR currency", async () => {
      const input = {
        amount: 10,
        currency_code: "USD",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Only ZAR currency is supported")
    })
  })

  describe("Amount units", () => {
    beforeEach(() => {
      service = new YocoPaymentService({ logger: mockLogger }, { secretKey: "sk_test_1234567890", debug: false })
    })

    it("sends major units to Yoco as cents when initiating", async () => {
      const api = jest.fn().mockResolvedValue({ id: "ch_1", redirectUrl: "https://x", status: "created" })
      ;(service as any).api = api

      await service.initiatePayment({ amount: 270.85, currency_code: "zar", context: { session_id: "s1" } } as any)

      expect(api.mock.calls[0][2].amount).toBe(27085)
    })

    it("sends major units to Yoco as cents when updating", async () => {
      const api = jest.fn().mockResolvedValue({ id: "ch_2", redirectUrl: "https://x", status: "created" })
      ;(service as any).api = api

      await service.updatePayment({ amount: 270.85, currency_code: "zar", context: { session_id: "s1" } } as any)

      expect(api.mock.calls[0][2].amount).toBe(27085)
    })

    it("refunds major units as cents", async () => {
      const api = jest.fn().mockResolvedValue({ refundId: "r1", status: "successful", amount: 5000 })
      ;(service as any).api = api

      await service.refundPayment({ amount: 50, data: { yocoCheckoutId: "ch_1" } } as any)

      expect(api.mock.calls[0][2]).toEqual({ amount: 5000 })
    })
  })

  describe("Payment session id and retries", () => {
    const make = () => new YocoPaymentService({ logger: mockLogger }, { secretKey: "sk_test_1234567890", debug: false })
    const checkout = { id: "ch_1", redirectUrl: "https://x", status: "created" }

    it("reads the session id Medusa provides (data.session_id / context.idempotency_key)", async () => {
      const service = make()
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.initiatePayment({
        amount: 10,
        currency_code: "zar",
        data: { session_id: "payses_1" },
        context: { idempotency_key: "payses_1" },
      } as any)

      const [, , payload, key] = api.mock.calls[0]
      expect(payload.metadata.session_id).toBe("payses_1")
      expect(payload.externalId).toBe("payses_1")
      expect(key).toBe("initiate-payses_1-1000")
    })

    it("falls back to context.idempotency_key when data has no session id", async () => {
      const service = make()
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.initiatePayment({ amount: 10, currency_code: "zar", context: { idempotency_key: "payses_2" } } as any)

      expect(api.mock.calls[0][2].metadata.session_id).toBe("payses_2")
    })

    it("uses a different idempotency key for a new session of the same cart and amount", async () => {
      const service = make()
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      for (const id of ["payses_a", "payses_b"]) {
        await service.initiatePayment({ amount: 10, currency_code: "zar", data: { session_id: id }, context: { idempotency_key: id } } as any)
      }

      expect(api.mock.calls[0][3]).not.toBe(api.mock.calls[1][3])
    })

    it("never shares an idempotency key when the session id is missing", async () => {
      const service = make()
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.initiatePayment({ amount: 10, currency_code: "zar", context: {} } as any)
      await service.initiatePayment({ amount: 10, currency_code: "zar", context: {} } as any)

      expect(api.mock.calls[0][3]).not.toBe(api.mock.calls[1][3])
    })

    it("keeps the session id in the stored data and reuses it on update", async () => {
      const service = make()
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      const created = await service.initiatePayment({ amount: 10, currency_code: "zar", data: { session_id: "payses_3" }, context: { idempotency_key: "payses_3" } } as any)
      expect(created.data?.session_id).toBe("payses_3")

      await service.updatePayment({ amount: 20, currency_code: "zar", data: created.data, context: {} } as any)
      expect(api.mock.calls[1][2].metadata.session_id).toBe("payses_3")
      expect(api.mock.calls[1][2].amount).toBe(2000)
    })
  })

  describe("Webhooks", () => {
    const crypto = require("crypto")
    const secret = "whsec_" + Buffer.from("test-secret-bytes").toString("base64")
    const event = JSON.stringify({
      id: "evt_1",
      type: "payment.succeeded",
      createdDate: "2026-01-01T00:00:00Z",
      payload: { id: "p1", status: "succeeded", amount: 27085, currency: "ZAR", metadata: { session_id: "payses_1" } },
    })
    const signed = (body: string, s = secret) => {
      const ts = String(Math.floor(Date.now() / 1000))
      const sig = crypto
        .createHmac("sha256", Buffer.from(s.replace(/^whsec_/, ""), "base64"))
        .update(`msg_1.${ts}.${body}`)
        .digest("base64")
      return { "webhook-id": "msg_1", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }
    }
    const make = (webhookSecret?: string) =>
      new YocoPaymentService({ logger: mockLogger }, { secretKey: "sk_test_1234567890", debug: false, webhookSecret })

    it("authorizes a correctly signed payment.succeeded and converts cents to major units", async () => {
      const result = await make(secret).getWebhookActionAndData({ data: JSON.parse(event), rawData: event, headers: signed(event) } as any)

      expect(result).toEqual({ action: "authorized", data: { session_id: "payses_1", amount: 270.85 } })
    })

    it("maps a signed payment.failed to failed", async () => {
      const body = event.replace("payment.succeeded", "payment.failed")
      const result = await make(secret).getWebhookActionAndData({ data: JSON.parse(body), rawData: body, headers: signed(body) } as any)

      expect(result.action).toBe("failed")
    })

    it("ignores a webhook with a bad signature", async () => {
      const headers = { ...signed(event), "webhook-signature": "v1,AAAA" }
      const result = await make(secret).getWebhookActionAndData({ data: JSON.parse(event), rawData: event, headers } as any)

      expect(result).toEqual({ action: "not_supported" })
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it("ignores a forged event signed with another secret", async () => {
      const other = "whsec_" + Buffer.from("attacker").toString("base64")
      const result = await make(secret).getWebhookActionAndData({ data: JSON.parse(event), rawData: event, headers: signed(event, other) } as any)

      expect(result).toEqual({ action: "not_supported" })
    })

    it("ignores every webhook when no webhookSecret is configured", async () => {
      const result = await make().getWebhookActionAndData({ data: JSON.parse(event), rawData: event, headers: signed(event) } as any)

      expect(result).toEqual({ action: "not_supported" })
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it("validates the webhookSecret format", () => {
      expect(YocoOptionsSchema.safeParse({ secretKey: "sk_test_1", webhookSecret: "nope" }).success).toBe(false)
      expect(YocoOptionsSchema.safeParse({ secretKey: "sk_test_1", webhookSecret: secret }).success).toBe(true)
    })
  })
})
