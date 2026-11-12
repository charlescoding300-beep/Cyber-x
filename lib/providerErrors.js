'use strict'

// Normalize the provider's misspelled credit configuration error for users.
// This cannot add credits; the provider account must be configured separately.
function creditConfigurationHint(error, service = 'AI') {
  const raw = typeof error === 'string' ? error : String(error?.message || error || '')
  const text = raw.replace(/\s+/g, ' ').trim()
  const missingCreditConfig =
    /credit[\s_-]*not[\s_-]*config(?:ured|ed)?/i.test(text) ||
    /credits?\s+(?:are\s+)?not\s+configured/i.test(text) ||
    /billing.{0,50}not\s+configured/i.test(text)

  if (!missingCreditConfig) return null

  return service + ' provider credits or billing are not configured for this API account. Check the provider account settings or use an account with active credits.'
}

module.exports = { creditConfigurationHint }
