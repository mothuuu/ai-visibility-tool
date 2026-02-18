/**
 * Thrown when a spend operation cannot be fulfilled because
 * the user's total available tokens (monthly + purchased) is
 * less than the requested amount.
 */
class InsufficientTokensError extends Error {
  constructor(requested, available) {
    super(`Insufficient tokens: requested ${requested}, available ${available}`);
    this.name = 'InsufficientTokensError';
    this.requested = requested;
    this.available = available;
  }
}

module.exports = InsufficientTokensError;
