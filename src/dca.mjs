/**
 * Shelfbreak — DCA Analysis (Section 5.6)
 *
 * Classifies DCA pressure from CLOBr dca-orders response.
 */

/**
 * Compute DCA classification from CLOBr dca-orders data.
 * @param {object} dcaData - Raw CLOBr /dca-orders response
 * @param {number} currentPrice - Current token price
 * @returns {object} DCA classification
 */
export function computeDCA(dcaData, currentPrice) {
  const defaultResult = {
    bias: 'neutral',
    stack_below: false,
    near_price: false,
    headwind_above: false,
    support_score: 'neutral',
    raw: { buyVolume: 0, sellVolume: 0, orderCount: 0 },
  };

  if (!dcaData || !dcaData.orders || !Array.isArray(dcaData.orders)) {
    return defaultResult;
  }

  const orders = dcaData.orders;
  if (orders.length === 0) return defaultResult;

  let buyVolume = 0;
  let sellVolume = 0;
  let buyBelowCount = 0;
  let sellAboveCount = 0;
  let nearPriceCount = 0;

  for (const order of orders) {
    const remaining = order.remaining_usd ?? 0;
    const direction = (order.direction || '').toUpperCase();

    if (direction === 'BUY') {
      buyVolume += remaining;
      // Check if this buy DCA is below current price (stacking support)
      if (order.in_active_range === false || (order.min_price && order.min_price < currentPrice)) {
        buyBelowCount++;
      }
    } else if (direction === 'SELL') {
      sellVolume += remaining;
      // Check if this sell DCA is above current price (headwind)
      if (order.in_active_range === true || (order.max_price && order.max_price > currentPrice)) {
        sellAboveCount++;
      }
    }

    // Near price: within 5% of current
    if (order.in_active_range) {
      nearPriceCount++;
    }
  }

  // Bias
  let bias;
  const netBias = buyVolume - sellVolume;
  const totalVolume = buyVolume + sellVolume;
  if (totalVolume === 0) bias = 'neutral';
  else if (netBias > totalVolume * 0.3) bias = 'bullish';
  else if (netBias < -totalVolume * 0.3) bias = 'bearish';
  else bias = 'neutral';

  const stack_below = buyBelowCount >= 2;
  const near_price = nearPriceCount >= 1;
  const headwind_above = sellAboveCount >= 2 && sellVolume > buyVolume;

  // Support score
  let support_score;
  if (bias === 'bullish' && stack_below) support_score = 'helpful';
  else if (bias === 'bearish' && headwind_above) support_score = 'opposing';
  else support_score = 'neutral';

  return {
    bias,
    stack_below,
    near_price,
    headwind_above,
    support_score,
    raw: { buyVolume, sellVolume, orderCount: orders.length },
  };
}
