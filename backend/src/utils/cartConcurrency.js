const Cart = require('../models/Cart');

class CartMutationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isRetryableCartWrite = (error) => (
  error?.name === 'VersionError' || error?.code === 11000
);

/**
 * Run one cart mutation against the latest document, retrying stale writes.
 * The unique ownership indexes make creation safe across processes; the
 * optimistic version check prevents lost updates across tabs/requests.
 */
const createCartMutation = ({ CartModel = Cart } = {}) => async (filter, mutate, { create = false, attempts = 3 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let cart = await CartModel.findOne(filter);
    if (!cart && create) cart = new CartModel(filter);
    if (!cart) return null;
    try {
      await mutate(cart, attempt);
      cart.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await cart.save();
      return cart;
    } catch (error) {
      if (isRetryableCartWrite(error)) {
        if (attempt + 1 >= attempts) throw new CartMutationError(409, 'Cart changed concurrently. Please retry.');
        continue;
      }
      throw error;
    }
  }
  throw new CartMutationError(409, 'Cart changed concurrently. Please retry.');
};

const mutateCartWithRetry = createCartMutation();

module.exports = { CartMutationError, isRetryableCartWrite, createCartMutation, mutateCartWithRetry };
