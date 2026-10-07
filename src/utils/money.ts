/**
 * Medusa v2 passes payment amounts in major units (270.85 means R270.85).
 * Yoco's API works in cents.
 */
export const toCents = (amount: unknown): number => Math.round(Number(amount) * 100)

export const fromCents = (cents: unknown): number => Number(cents) / 100
