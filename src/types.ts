export interface YocoOptions {
  /** Your Yoco secret key (sk_test_... or sk_live_...) */
  secretKey: string
  /** Enable debug logging */
  debug?: boolean
}

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

export interface YocoError {
  errorCode: string
  errorMessage: string
  displayMessage?: string
}
