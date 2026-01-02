# medusa-payment-yoco

A payment provider for Medusa v2 that makes it easy to accept card payments in South Africa. With just a few lines of code, you can enable your customers to pay with Visa, Mastercard, American Express, and Instant EFT.

The package handles the Yoco Checkout API flow, and provides a simple and consistent integration with Medusa's payment system. It also handles webhooks for payment confirmation, making it easy to integrate with your existing store.

![Yoco Checkout](https://raw.githubusercontent.com/Nolunga/medusa-payment-yoco/main/assets/yoco-checkout.png)

## Features

- ✅ Accept payments via Yoco's secure hosted checkout
- ✅ Webhook support for real-time payment updates
- ✅ Full refund support
- ✅ Test & Live mode support
- ✅ TypeScript support
- ✅ Debug logging

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
```

### Enable Yoco in your region

1. Go to Medusa Admin → Settings → Regions
2. Select your South Africa region
3. Add **Yoco** as a payment provider
4. Save

## Cool stuff girly-pop 💅🏾 You're ready to accept payments 🎉

![Payment Success](https://media.giphy.com/media/3QwogXfR2vfZS/giphy.gif)

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

| Option      | Type      | Required | Description                                       |
| ----------- | --------- | -------- | ------------------------------------------------- |
| `secretKey` | `string`  | ✅       | Your Yoco secret key (sk_test_... or sk_live_...) |
| `debug`     | `boolean` | ❌       | Enable debug logging (default: false)             |

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

## Troubleshooting

**Payment session not created?**
- Check your secret key is correct
- Ensure Yoco is enabled in your region
- Enable `debug: true` to see detailed logs

**Webhooks not working?**
- Webhook URL must be publicly accessible
- URL format: `https://your-domain.com/hooks/payment/yoco_yoco`
- Check webhook is enabled in Yoco dashboard

## Links

- [Yoco Developer Docs](https://developer.yoco.com/)
- [Yoco Business Portal](https://portal.yoco.com/)
- [Medusa Documentation](https://docs.medusajs.com/)

## License

MIT
