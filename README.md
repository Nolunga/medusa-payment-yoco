# medusa-payment-yoco

A payment provider for Medusa v2 that makes it easy to accept card payments in South Africa. With just a few lines of code, you can enable your customers to pay with Visa, Mastercard, American Express, and Instant EFT.

The package handles the Yoco Checkout API flow, and provides a simple and consistent integration with Medusa's payment system. It also handles webhooks for payment confirmation, making it easy to integrate with your existing store.

![Yoco Logo](https://raw.githubusercontent.com/Nolunga/medusa-payment-yoco/main/assets/yoco-logo-og-3.png)

## Features

- ✅ Accept payments via Yoco's secure hosted checkout
- ✅ Webhook support for real-time payment updates
- ✅ Full and partial refund support
- ✅ Test & Live mode support
- ✅ Configurable redirect URLs for success, cancel, and failure
- ✅ Idempotency keys to prevent duplicate charges
- ✅ Production-grade error handling with detailed error codes
- ✅ Input validation with Zod
- ✅ TypeScript support with full type definitions
- ✅ Debug logging
- ✅ Comprehensive test coverage

## Compatibility

This package is compatible with Medusa v2.0.0 and above.

## How to use this cute package

### Install the package

using yarn

```
yarn add medusa-payment-yoco
```

using npm

```
npm install medusa-payment-yoco
```

### Add it to your Medusa config

```typescript
// medusa-config.ts
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  projectConfig: {
    // your config...
  },
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-yoco",
            id: "yoco",
            options: {
              secretKey: process.env.YOCO_SECRET_KEY,
              debug: true,
              // Optional: Configure redirect URLs after payment
              successUrl: process.env.YOCO_SUCCESS_URL,
              cancelUrl: process.env.YOCO_CANCEL_URL,
              failureUrl: process.env.YOCO_FAILURE_URL,
            },
          },
        ],
      },
    },
  ],
})
```

### Add your Yoco keys to .env

```env
# Get these from Yoco Business Portal > Selling Online > Payment Gateway
YOCO_SECRET_KEY=sk_test_xxxxxxxxxxxx

# Optional: Redirect URLs after payment (recommended for production)
YOCO_SUCCESS_URL=https://your-store.com/checkout/success
YOCO_CANCEL_URL=https://your-store.com/checkout/cancel
YOCO_FAILURE_URL=https://your-store.com/checkout/failure
```

### Enable Yoco in your region

1. Go to Medusa Admin → Settings → Regions
2. Select your South Africa region
3. Add **Yoco** as a payment provider
4. Save

## Cool stuff girly-pop 💅🏾 You're ready to accept payments 🎉

![Payment Success](https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcHNkeWdmODR2MDBibnZtMDk3b2FyZGJoYW1yYTZ1MWh1NzhsNGk2YiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/9thduMKTL4Dcc/giphy.gif)

## Storefront Integration

### Initialize payment with Yoco

```typescript
// Select Yoco as payment provider
await medusa.store.cart.initiatePaymentSession(cartId, {
  provider_id: "pp_yoco_yoco",
})
```

### Redirect to Yoco checkout

```typescript
const { cart } = await medusa.store.cart.retrieve(cartId)

const paymentSession = cart.payment_collection?.payment_sessions?.find(
  (ps) => ps.provider_id === "pp_yoco_yoco"
)

// Redirect customer to Yoco's secure payment page
window.location.href = paymentSession?.data?.redirectUrl
```

### Complete the order after payment

```typescript
// On your return page
const { type, order } = await medusa.store.cart.complete(cartId)

if (type === "order") {
  // Success! 🎉
  router.push(`/order/${order.id}`)
}
```

## Configuration Options

| Option       | Type      | Required | Description                                                                  |
| ------------ | --------- | -------- | ---------------------------------------------------------------------------- |
| `secretKey`  | `string`  | ✅       | Your Yoco secret key (sk_test_... or sk_live_...)                            |
| `debug`      | `boolean` | ❌       | Enable debug logging (default: false)                                        |
| `successUrl` | `string`  | ❌       | URL to redirect to after successful payment                                  |
| `cancelUrl`  | `string`  | ❌       | URL to redirect to after cancelled payment                                   |
| `failureUrl` | `string`  | ❌       | URL to redirect to after failed payment                                      |

### Redirect URLs

When configured, Yoco will automatically redirect customers back to your store after completing, cancelling, or failing a payment. This provides a better user experience by seamlessly bringing customers back to your checkout flow.

**Example redirect URLs:**
- Success: `https://your-store.com/checkout/success?session_id={session_id}`
- Cancel: `https://your-store.com/checkout/cancel?session_id={session_id}`
- Failure: `https://your-store.com/checkout/failure?session_id={session_id}`

You can access the session ID from the URL query parameter to complete the order or handle errors appropriately.

## Webhook Setup (Production)

For production, set up webhooks in your Yoco Business Portal:

1. Go to **Selling Online → Payment Gateway → Webhooks**
2. Add webhook URL: `https://your-domain.com/hooks/payment/yoco_yoco`
3. Select events: `payment.succeeded`, `payment.failed`

## Test Cards

| Card Number         | Result   |
| ------------------- | -------- |
| 4000 0000 0000 0000 | ✅ Success  |
| 4000 0000 0000 0002 | ❌ Declined |

Use any future expiry date and any CVV.

## Yoco Fees

No monthly fees - only pay when you get paid! 💰

- Local Cards: 2.6% - 2.95%
- International/AMEX: 3.05% - 3.5%
- Instant EFT: 2%

See [Yoco Pricing](https://www.yoco.com/za/fees/) for details.

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type { YocoOptions } from "medusa-payment-yoco"
```

## Production Best Practices

### Idempotency

The package automatically handles idempotency for checkout creation and refunds using unique keys. This prevents duplicate charges if a network timeout causes a retry.

### Error Handling

The package provides detailed error codes for better error handling in your storefront:

```typescript
import { YocoPaymentError, YocoErrorCode } from "medusa-payment-yoco"

try {
  // Payment logic
} catch (error) {
  if (error instanceof YocoPaymentError) {
    switch (error.code) {
      case YocoErrorCode.CARD_DECLINED:
        // Show user-friendly message
        break
      case YocoErrorCode.INSUFFICIENT_FUNDS:
        // Handle insufficient funds
        break
      // ... handle other error codes
    }
  }
}
```

Available error codes:
- `CARD_DECLINED` - Card was declined
- `INSUFFICIENT_FUNDS` - Insufficient funds
- `INVALID_CARD` - Invalid card details
- `EXPIRED_CARD` - Card has expired
- `INVALID_CVV` - Invalid CVV code
- `FRAUD_DETECTED` - Transaction flagged as fraudulent
- `LIMIT_EXCEEDED` - Transaction limit exceeded
- `NETWORK_ERROR` - Network communication error
- `API_ERROR` - General API error

### Partial Refunds

The package supports partial refunds. Simply specify the amount when calling refund:

```typescript
// Refund R50.00 (5000 cents)
await paymentService.refundPayment({
  payment_id: "payment_123",
  amount: 5000,
  // ...
})
```

### Logging

Enable debug logging in production with caution:

```typescript
{
  secretKey: process.env.YOCO_SECRET_KEY,
  debug: process.env.NODE_ENV === "development", // Only in development
}
```

## Troubleshooting

**Payment session not created?**
- Check your secret key is correct (must start with `sk_test_` or `sk_live_`)
- Ensure Yoco is enabled in your region
- Enable `debug: true` to see detailed logs
- Check that redirect URLs are valid HTTPS URLs

**Webhooks not working?**
- Webhook URL must be publicly accessible
- URL format: `https://your-domain.com/hooks/payment/yoco_yoco`
- Check webhook is enabled in Yoco dashboard
- Verify webhook events are selected: `payment.succeeded`, `payment.failed`

**Configuration validation errors?**
- The package uses Zod for configuration validation
- Check the error message for specific validation failures
- Ensure all URLs use HTTPS protocol

## Links

- [Yoco Developer Docs](https://developer.yoco.com/)
- [Yoco Business Portal](https://portal.yoco.com/)
- [Medusa Documentation](https://docs.medusajs.com/)

## License

MIT
