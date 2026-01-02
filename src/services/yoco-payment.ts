import {
  AbstractPaymentProvider,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  PaymentSessionStatus,
  CreatePaymentProviderSession,
  UpdatePaymentProviderSession,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import { YocoOptions, YocoCheckout, YocoRefund, YocoWebhookEvent, YocoError } from "../types"

const YOCO_API = "https://payments.yoco.com/api"

class YocoPaymentService extends AbstractPaymentProvider<YocoOptions> {
  static identifier = "yoco"

  protected options_: YocoOptions
  protected logger_: Logger

  constructor(container: Record<string, unknown>, options: YocoOptions) {
    super(container, options)
    this.options_ = options
    this.logger_ = container.logger as Logger

    if (!options.secretKey) {
      throw new Error("[Yoco] secretKey is required")
    }

    if (!options.secretKey.startsWith("sk_")) {
      throw new Error("[Yoco] Invalid secretKey format")
    }

    this.log("Initialized", { mode: options.secretKey.includes("test") ? "test" : "live" })
  }

  // ============================================
  // HELPERS
  // ============================================

  private log(msg: string, data?: unknown) {
    if (this.options_.debug) {
      this.logger_.info(`[Yoco] ${msg}`, data ? { data } : undefined)
    }
  }

  private async api<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
    this.log(`${method} ${endpoint}`, body)

    const res = await fetch(`${YOCO_API}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options_.secretKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await res.json()

    if (!res.ok) {
      const err = data as YocoError
      throw new Error(err.displayMessage || err.errorMessage || "Yoco API error")
    }

    return data as T
  }

  private error(message: string, code: string): PaymentProviderError {
    this.log(`Error: ${message}`, { code })
    return { error: message, code }
  }

  private mapStatus(status: string): PaymentSessionStatus {
    const map: Record<string, PaymentSessionStatus> = {
      completed: PaymentSessionStatus.AUTHORIZED,
      cancelled: PaymentSessionStatus.CANCELED,
      expired: PaymentSessionStatus.ERROR,
    }
    return map[status] || PaymentSessionStatus.PENDING
  }

  // ============================================
  // PAYMENT METHODS
  // ============================================

  async initiatePayment(
    input: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const { amount, currency_code, context } = input

    try {
      const amountInCents = Math.round(amount)

      if (amountInCents < 200) {
        return this.error("Minimum amount is R2.00", "MIN_AMOUNT")
      }

      if (currency_code.toUpperCase() !== "ZAR") {
        return this.error("Only ZAR currency supported", "INVALID_CURRENCY")
      }

      const checkout = await this.api<YocoCheckout>("/checkouts", "POST", {
        amount: amountInCents,
        currency: "ZAR",
        metadata: {
          session_id: context?.session_id,
          resource_id: context?.resource_id,
        },
        externalId: context?.session_id,
      })

      return {
        data: {
          yocoCheckoutId: checkout.id,
          redirectUrl: checkout.redirectUrl,
          status: checkout.status,
        },
      }
    } catch (err) {
      return this.error((err as Error).message, "INIT_ERROR")
    }
  }

  async updatePayment(
    input: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    return this.initiatePayment(input)
  }

  async deletePayment(data: Record<string, unknown>) {
    return { ...data, deleted: true }
  }

  async getPaymentStatus(data: Record<string, unknown>): Promise<PaymentSessionStatus> {
    const id = data.yocoCheckoutId as string
    if (!id) return PaymentSessionStatus.ERROR

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)
      return this.mapStatus(checkout.status)
    } catch {
      return PaymentSessionStatus.ERROR
    }
  }

  async authorizePayment(data: Record<string, unknown>) {
    const id = data.yocoCheckoutId as string

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)

      return {
        status: this.mapStatus(checkout.status),
        data: {
          ...data,
          yocoPaymentId: checkout.paymentId,
        },
      }
    } catch (err) {
      return this.error((err as Error).message, "AUTH_ERROR")
    }
  }

  async capturePayment(data: Record<string, unknown>) {
    const id = data.yocoCheckoutId as string

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)

      if (checkout.status !== "completed") {
        return this.error(`Payment not completed: ${checkout.status}`, "CAPTURE_ERROR")
      }

      return {
        ...data,
        yocoPaymentId: checkout.paymentId,
        capturedAt: new Date().toISOString(),
      }
    } catch (err) {
      return this.error((err as Error).message, "CAPTURE_ERROR")
    }
  }

  async refundPayment(data: Record<string, unknown>, amount: number) {
    const id = data.yocoCheckoutId as string

    if (!id) {
      return this.error("No checkout ID", "REFUND_ERROR")
    }

    try {
      const refund = await this.api<YocoRefund>(`/checkouts/${id}/refund`, "POST")

      if (refund.status !== "successful") {
        return this.error(refund.message, "REFUND_FAILED")
      }

      return {
        ...data,
        yocoRefundId: refund.refundId,
        refundedAt: new Date().toISOString(),
      }
    } catch (err) {
      return this.error((err as Error).message, "REFUND_ERROR")
    }
  }

  async cancelPayment(data: Record<string, unknown>) {
    return { ...data, cancelledAt: new Date().toISOString() }
  }

  async retrievePayment(data: Record<string, unknown>) {
    const id = data.yocoCheckoutId as string
    if (!id) return data

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)
      return { ...data, yocoStatus: checkout.status, yocoPaymentId: checkout.paymentId }
    } catch (err) {
      return this.error((err as Error).message, "RETRIEVE_ERROR")
    }
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const event = payload.data as unknown as YocoWebhookEvent
    this.log(`Webhook: ${event.type}`, event)

    const sessionId = (event.payload.metadata?.session_id as string) || ""

    if (event.type === "payment.succeeded") {
      return { action: "authorized", data: { session_id: sessionId, amount: event.payload.amount } }
    }

    if (event.type === "payment.failed") {
      return { action: "failed", data: { session_id: sessionId, amount: event.payload.amount } }
    }

    return { action: "not_supported" }
  }
}

export default YocoPaymentService
