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
import { randomUUID } from "crypto"
import { fromCents, toCents } from "../utils/money"
import { verifyWebhookSignature } from "../utils/webhook"
import {
  YocoOptions,
  YocoOptionsSchema,
  YocoCheckout,
  YocoRefund,
  YocoWebhookEvent,
  YocoError,
  YocoPaymentError,
  YocoErrorCode,
} from "../types"

const YOCO_API = "https://payments.yoco.com/api"
const MIN_AMOUNT_CENTS = 200 // R2.00 minimum

class YocoPaymentService extends AbstractPaymentProvider<YocoOptions> {
  static identifier = "yoco"

  protected options_: YocoOptions
  protected logger_: Logger

  constructor(container: Record<string, unknown>, options: YocoOptions) {
    super(container, options)

    // Validate options with Zod
    const validationResult = YocoOptionsSchema.safeParse(options)
    if (!validationResult.success) {
      const errors = validationResult.error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join(", ")
      throw new Error(`[Yoco] Configuration validation failed: ${errors}`)
    }

    this.options_ = validationResult.data
    this.logger_ = container.logger as Logger

    this.log("Initialized with validated configuration")
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Medusa hands the payment session id to providers as `data.session_id` (initiate) and
   * `context.idempotency_key` (initiate / update); `context.session_id` is never set.
   * Reading the wrong field left every checkout with an empty session id, so all sessions
   * of a cart shared one idempotency key (a retry reused the cancelled checkout) and
   * webhooks could not be matched back to a session.
   */
  private sessionIdOf(input: { data?: Record<string, unknown>; context?: unknown }): string {
    const context = (input.context ?? {}) as Record<string, unknown>
    return (
      (input.data?.session_id as string | undefined) ||
      (context.idempotency_key as string | undefined) ||
      (context.session_id as string | undefined) ||
      ""
    )
  }

  private log(msg: string, level: "info" | "warn" | "error" = "info") {
    if (this.options_.debug) {
      this.logger_[level](`[Yoco] ${msg}`)
    }
  }

  private async api<T>(
    endpoint: string,
    method = "GET",
    body?: object,
    idempotencyKey?: string
  ): Promise<T> {
    this.log(`${method} ${endpoint}`)

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.options_.secretKey}`,
    }

    // Add idempotency key for POST requests (prevents duplicate charges)
    if (method === "POST" && idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey
      this.log(`Using idempotency key: ${idempotencyKey}`)
    }

    try {
      const res = await fetch(`${YOCO_API}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      const data = await res.json()

      if (!res.ok) {
        const err = data as YocoError
        this.log(`API error: ${err.errorCode} - ${err.errorMessage}`, "error")
        throw YocoPaymentError.fromYocoError(err)
      }

      return data as T
    } catch (error) {
      if (error instanceof YocoPaymentError) {
        throw error
      }
      // Network or JSON parsing errors
      this.log(`Network error: ${(error as Error).message}`, "error")
      throw new YocoPaymentError(
        "Network error communicating with Yoco",
        YocoErrorCode.NETWORK_ERROR,
        error
      )
    }
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
      const amountInCents = toCents(amount)

      // Validate amount
      if (amountInCents < MIN_AMOUNT_CENTS) {
        throw new YocoPaymentError(
          `Minimum amount is R${MIN_AMOUNT_CENTS / 100}.00`,
          YocoErrorCode.API_ERROR
        )
      }

      // Validate currency
      if (currency_code.toUpperCase() !== "ZAR") {
        throw new YocoPaymentError("Only ZAR currency is supported", YocoErrorCode.API_ERROR)
      }

      const sessionId = this.sessionIdOf(input)
      const resourceId = ((context as any)?.resource_id as string | undefined) || ""

      // One checkout per payment session and amount. A new session (e.g. a retry after a
      // cancelled or failed payment) must get a new checkout, so never share a key across
      // sessions: fall back to a random key if the session id is somehow missing.
      const idempotencyKey = sessionId
        ? `initiate-${sessionId}-${amountInCents}`
        : `initiate-${randomUUID()}`

      const checkoutPayload: any = {
        amount: amountInCents,
        currency: "ZAR",
        metadata: {
          session_id: sessionId,
          resource_id: resourceId,
        },
        externalId: sessionId,
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

      const checkout = await this.api<YocoCheckout>("/checkouts", "POST", checkoutPayload, idempotencyKey)

      this.log(`Payment initiated: ${checkout.id}`)

      return {
        id: checkout.id,
        data: {
          session_id: sessionId,
          yocoCheckoutId: checkout.id,
          redirectUrl: checkout.redirectUrl,
          status: checkout.status,
        },
      }
    } catch (err) {
      if (err instanceof YocoPaymentError) {
        throw new Error(`[Yoco] ${err.message}`)
      }
      throw new Error(`[Yoco] Failed to initiate payment: ${(err as Error).message}`)
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const { amount, currency_code, context } = input

    try {
      const amountInCents = toCents(amount)

      if (amountInCents < MIN_AMOUNT_CENTS) {
        throw new Error("Minimum amount is R2.00")
      }

      if (currency_code.toUpperCase() !== "ZAR") {
        throw new Error("Only ZAR currency supported")
      }

      const sessionId = this.sessionIdOf(input)
      const checkoutPayload: any = {
        amount: amountInCents,
        currency: "ZAR",
        metadata: {
          session_id: sessionId,
          resource_id: (context as any)?.resource_id,
        },
        externalId: sessionId,
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
          session_id: sessionId,
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
    // Medusa passes major units; Yoco refunds in cents.
    const refundAmount = input.amount ? toCents(input.amount) : undefined

    if (!id) {
      throw new YocoPaymentError("[Yoco] No checkout ID provided for refund", YocoErrorCode.API_ERROR)
    }

    try {
      // Generate idempotency key for refund
      const idempotencyKey = refundAmount
        ? `refund-${id}-${refundAmount}-${randomUUID()}`
        : `refund-${id}-full-${randomUUID()}`

      // Build refund payload (supports partial refunds if amount is provided)
      const refundPayload: any = refundAmount ? { amount: refundAmount } : {}

      this.log(
        refundAmount
          ? `Initiating partial refund of R${refundAmount / 100} for checkout ${id}`
          : `Initiating full refund for checkout ${id}`
      )

      const refund = await this.api<YocoRefund>(
        `/checkouts/${id}/refund`,
        "POST",
        refundPayload,
        idempotencyKey
      )

      if (refund.status !== "successful") {
        throw new YocoPaymentError(refund.message, YocoErrorCode.PROCESSING_ERROR)
      }

      this.log(`Refund successful: ${refund.refundId}`)

      return {
        data: {
          ...input.data,
          yocoRefundId: refund.refundId,
          refundedAmount: refund.amount || refundAmount,
          refundedAt: new Date().toISOString(),
        },
      }
    } catch (err) {
      if (err instanceof YocoPaymentError) {
        throw new Error(`[Yoco] ${err.message}`)
      }
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
    const secret = this.options_.webhookSecret
    if (!secret) {
      // Always logged (not behind `debug`): a silently ignored webhook is hard to diagnose.
      this.logger_.warn("[Yoco] Webhook ignored: no webhookSecret configured")
      return { action: "not_supported" }
    }

    const raw = payload.rawData as unknown
    const rawBody =
      typeof raw === "string" ? raw : raw ? Buffer.from(raw as Uint8Array).toString("utf8") : ""

    if (!verifyWebhookSignature(rawBody, (payload.headers ?? {}) as Record<string, string>, secret)) {
      this.logger_.warn("[Yoco] Webhook ignored: invalid signature")
      return { action: "not_supported" }
    }

    let event: YocoWebhookEvent
    try {
      event = JSON.parse(rawBody) as YocoWebhookEvent
    } catch {
      return { action: "not_supported" }
    }
    this.log(`Webhook: ${event.type}`)

    const sessionId = (event.payload?.metadata?.session_id as string) || ""
    // Yoco reports cents; Medusa expects major units.
    const data = { session_id: sessionId, amount: fromCents(event.payload?.amount) }

    if (event.type === "payment.succeeded") {
      return { action: "authorized", data }
    }

    if (event.type === "payment.failed") {
      return { action: "failed", data }
    }

    return { action: "not_supported" }
  }
}

export default YocoPaymentService
