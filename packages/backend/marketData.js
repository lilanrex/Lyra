import fetch from 'node-fetch';

async function getSoltoUsdRate() {
  try {
    const res = await fetch(`https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`);
    const data = await res.json();
    
    if (data.length > 0 && data[0].price) {
      const pythPrice = data[0].price;
      const price = parseFloat(pythPrice.price);
      const exponent = parseInt(pythPrice.expo);
      const actualPrice = price * Math.pow(10, exponent);
      console.log('Debugging SOL/USD', actualPrice);
      return actualPrice;
    } else {
      console.error("Pyth API response is malformed or missing price data.");
      return null;
    }
  } catch (err) {
    console.error('Error fetching data sol/usd', err);
    return null;
  }
}


// Placeholder for Marinade's Staking APY
async function getMarinadeStakingApy() {
    // In a real application, you would fetch this from Marinade's API or SDK.
    // For now, we can use a realistic static value.
    // See Marinade documentation for how to get this live.
    return 5.8; // Example: 5.8% APY
}

// Placeholder for a stablecoin yield (e.g., from Solend)
async function getStablecoinYield() {
    // In a real application, you would fetch this from a lending protocol's API.
    // For example, Solend has an API for their main pool rates.
    return 4.5; // Example: 4.5% APY on USDC
}

// Placeholder for market volatility
async function getSolVolatility() {
    // In a real application, you'd get this from a data provider like CoinGecko or a specialized service.
    // It's often calculated as the standard deviation of daily returns.
    return 2.15; // Example: 2.15% 24h volatility
}


/**
 * The main function that aggregates all market data needed for the AI advisor.
 */
export async function getMarketData() {
    // We can run these requests in parallel for better performance
    const [solPrice, stakingAPY, stableYield, volatility] = await Promise.all([
        getSoltoUsdRate(),
        getMarinadeStakingApy(),
        getStablecoinYield(),
        getSolVolatility()
    ]);

    return { solPrice, stakingAPY, stableYield, volatility };
}