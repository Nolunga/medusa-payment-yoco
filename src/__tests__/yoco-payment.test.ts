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
        amount: 100, // R1.00 - below minimum
        currency_code: "ZAR",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Minimum amount is R2.00")
    })

    it("should reject non-ZAR currency", async () => {
      const input = {
        amount: 1000,
        currency_code: "USD",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Only ZAR currency is supported")
    })
  })
})
