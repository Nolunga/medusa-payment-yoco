import { z } from "zod"

// ============================================
// CONFIGURATION SCHEMA
// ============================================

export const YocoOptionsSchema = z.object({
  secretKey: z
    .string()
    .min(1, "secretKey is required")
    .refine((val) => val.startsWith("sk_test_") || val.startsWith("sk_live_"), {
      message: "secretKey must start with 'sk_test_' or 'sk_live_'",
    }),
  debug: z.boolean().optional().default(false),
  successUrl: z.string().regex(/^https?:\/\/.+/, "successUrl must be a valid URL").optional(),
  cancelUrl: z.string().regex(/^https?:\/\/.+/, "cancelUrl must be a valid URL").optional(),
  failureUrl: z.string().regex(/^https?:\/\/.+/, "failureUrl must be a valid URL").optional(),
})

export type YocoOptions = z.infer<typeof YocoOptionsSchema>

// ============================================
// YOCO API TYPES
// ============================================

export interface YocoCheckout {
  id: string
  redirectUrl: string
  status: "created" | "pending" | "completed" | "cancelled" | "expired"
  amount: number
  currency: string
  paymentId: string | null
  metadata: Record<string, unknown>
}

export interface YocoRefund {
  id: string
  refundId: string
  message: string
  status: "successful" | "failed"
  amount?: number
}

export interface YocoWebhookEvent {
  id: string
  type: "payment.succeeded" | "payment.failed"
  createdDate: string
  payload: {
    id: string
    status: string
    amount: number
    currency: string
    metadata?: Record<string, unknown>
  }
}

// ============================================
// ERROR TYPES
// ============================================

export interface YocoError {
  errorCode: string
  errorMessage: string
  displayMessage?: string
}

export enum YocoErrorCode {
  CARD_DECLINED = "card_declined",
  INSUFFICIENT_FUNDS = "insufficient_funds",
  INVALID_CARD = "invalid_card",
  EXPIRED_CARD = "expired_card",
  INVALID_CVV = "invalid_cvv",
  PROCESSING_ERROR = "processing_error",
  FRAUD_DETECTED = "fraud_detected",
  LIMIT_EXCEEDED = "limit_exceeded",
  NETWORK_ERROR = "network_error",
  API_ERROR = "api_error",
}

export class YocoPaymentError extends Error {
  constructor(
    message: string,
    public code: YocoErrorCode,
    public originalError?: unknown
  ) {
    super(message)
    this.name = "YocoPaymentError"
  }

  static fromYocoError(error: YocoError): YocoPaymentError {
    const code = this.mapErrorCode(error.errorCode)
    const message = error.displayMessage || error.errorMessage || "Payment processing failed"
    return new YocoPaymentError(message, code, error)
  }

  private static mapErrorCode(errorCode: string): YocoErrorCode {
    const mapping: Record<string, YocoErrorCode> = {
      card_declined: YocoErrorCode.CARD_DECLINED,
      insufficient_funds: YocoErrorCode.INSUFFICIENT_FUNDS,
      invalid_card_number: YocoErrorCode.INVALID_CARD,
      expired_card: YocoErrorCode.EXPIRED_CARD,
      invalid_cvv: YocoErrorCode.INVALID_CVV,
      fraud: YocoErrorCode.FRAUD_DETECTED,
      limit_exceeded: YocoErrorCode.LIMIT_EXCEEDED,
    }
    return mapping[errorCode] || YocoErrorCode.API_ERROR
  }
}
