import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
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

    this.log("Initialized")
  }

  // ============================================
  // HELPERS
  // ============================================

  private log(msg: string) {
    if (this.options_.debug) {
      this.logger_.info(`[Yoco] ${msg}`)
    }
  }

  private async api<T>(endpoint: string, method = "GET", body?: object): Promise<T> {
    this.log(`${method} ${endpoint}`)

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

  private mapStatus(status: string): "authorized" | "captured" | "canceled" | "pending" {
    const map: Record<string, "authorized" | "captured" | "canceled" | "pending"> = {
      completed: "authorized",
      cancelled: "canceled",
      expired: "canceled",
    }
    return map[status] || "pending"
  }

  // ============================================
  // PAYMENT METHODS
  // ============================================

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, context } = input

    try {
      const amountInCents = Math.round(Number(amount))

      if (amountInCents < 200) {
        throw new Error("Minimum amount is R2.00")
      }

      if (currency_code.toUpperCase() !== "ZAR") {
        throw new Error("Only ZAR currency supported")
      }

      const checkoutPayload: any = {
        amount: amountInCents,
        currency: "ZAR",
        metadata: {
          session_id: (context as any)?.session_id,
          resource_id: (context as any)?.resource_id,
        },
        externalId: (context as any)?.session_id,
      }

      // Add redirect URLs if configured
      if (this.options_.successUrl) {
        checkoutPayload.successUrl = this.options_.successUrl
      }
      if (this.options_.cancelUrl) {
        checkoutPayload.cancelUrl = this.options_.cancelUrl
      }
      if (this.options_.failureUrl) {
        checkoutPayload.failureUrl = this.options_.failureUrl
      }

      const checkout = await this.api<YocoCheckout>("/checkouts", "POST", checkoutPayload)

      return {
        id: checkout.id,
        data: {
          yocoCheckoutId: checkout.id,
          redirectUrl: checkout.redirectUrl,
          status: checkout.status,
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to initiate payment: ${(err as Error).message}`)
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { amount, currency_code, context } = input

    try {
      const amountInCents = Math.round(Number(amount))

      if (amountInCents < 200) {
        throw new Error("Minimum amount is R2.00")
      }

      if (currency_code.toUpperCase() !== "ZAR") {
        throw new Error("Only ZAR currency supported")
      }

      const checkoutPayload: any = {
        amount: amountInCents,
        currency: "ZAR",
        metadata: {
          session_id: (context as any)?.session_id,
          resource_id: (context as any)?.resource_id,
        },
        externalId: (context as any)?.session_id,
      }

      // Add redirect URLs if configured
      if (this.options_.successUrl) {
        checkoutPayload.successUrl = this.options_.successUrl
      }
      if (this.options_.cancelUrl) {
        checkoutPayload.cancelUrl = this.options_.cancelUrl
      }
      if (this.options_.failureUrl) {
        checkoutPayload.failureUrl = this.options_.failureUrl
      }

      const checkout = await this.api<YocoCheckout>("/checkouts", "POST", checkoutPayload)

      return {
        data: {
          yocoCheckoutId: checkout.id,
          redirectUrl: checkout.redirectUrl,
          status: checkout.status,
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to update payment: ${(err as Error).message}`)
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return {
      data: input.data,
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const id = input.data?.yocoCheckoutId as string
    if (!id) {
      return { status: "pending" }
    }

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)
      return { status: this.mapStatus(checkout.status) }
    } catch {
      return { status: "pending" }
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const id = input.data?.yocoCheckoutId as string

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)

      return {
        status: this.mapStatus(checkout.status),
        data: {
          ...input.data,
          yocoPaymentId: checkout.paymentId,
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to authorize payment: ${(err as Error).message}`)
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const id = input.data?.yocoCheckoutId as string

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)

      if (checkout.status !== "completed") {
        throw new Error(`Payment not completed: ${checkout.status}`)
      }

      return {
        data: {
          ...input.data,
          yocoPaymentId: checkout.paymentId,
          capturedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to capture payment: ${(err as Error).message}`)
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const id = input.data?.yocoCheckoutId as string

    if (!id) {
      throw new Error("[Yoco] No checkout ID provided for refund")
    }

    try {
      const refund = await this.api<YocoRefund>(`/checkouts/${id}/refund`, "POST")

      if (refund.status !== "successful") {
        throw new Error(refund.message)
      }

      return {
        data: {
          ...input.data,
          yocoRefundId: refund.refundId,
          refundedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to refund payment: ${(err as Error).message}`)
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return {
      data: {
        ...input.data,
        cancelledAt: new Date().toISOString(),
      },
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const id = input.data?.yocoCheckoutId as string
    if (!id) {
      return { data: input.data }
    }

    try {
      const checkout = await this.api<YocoCheckout>(`/checkouts/${id}`)
      return {
        data: {
          ...input.data,
          yocoStatus: checkout.status,
          yocoPaymentId: checkout.paymentId,
        },
      }
    } catch (err) {
      throw new Error(`[Yoco] Failed to retrieve payment: ${(err as Error).message}`)
    }
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const event = payload.data as unknown as YocoWebhookEvent
    this.log(`Webhook: ${event.type}`)

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
