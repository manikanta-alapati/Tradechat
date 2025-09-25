const { KiteConnect } = require('kiteconnect');
const User = require('../models/User');
const Trade = require('../models/Trade');

class ZerodhaService {
  constructor() {
    this.kite = new KiteConnect({
      api_key: process.env.KITE_API_KEY
    });
    
    // Cache for frequently accessed data
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }
  
  // Generate auth URL with callback
  generateAuthURL(phoneNumber) {
    const sessionId = `session_${phoneNumber}_${Date.now()}`;
    const callbackUrl = process.env.KITE_REDIRECT_URL || 'http://localhost:3000/auth/callback';
    const authURL = `${this.kite.getLoginURL()}&redirect=${encodeURIComponent(callbackUrl)}&state=${phoneNumber}`;
    
    return {
      authURL,
      sessionId
    };
  }
  
  // Complete authentication
  async authenticateUser(requestToken, phoneNumber) {
    try {
      const response = await this.kite.generateSession(
        requestToken, 
        process.env.KITE_API_SECRET
      );
      
      // Set access token for this instance
      this.kite.setAccessToken(response.access_token);
      
      // Store in database
      const user = await User.findOne({ phoneNumber });
      if (user) {
        user.zerodhaAuth = {
          accessToken: response.access_token,
          userId: response.user_id,
          isAuthenticated: true,
          authenticatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        };
        await user.save();
      }
      
      return {
        success: true,
        accessToken: response.access_token,
        userId: response.user_id
      };
      
    } catch (error) {
      console.error('Authentication error:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Get user's Kite instance with access token
  async getUserKiteInstance(phoneNumber) {
    const user = await User.findOne({ phoneNumber });
    
    if (!user || !user.zerodhaAuth.isAuthenticated) {
      throw new Error('User not authenticated');
    }
    
    if (new Date() > user.zerodhaAuth.expiresAt) {
      throw new Error('Session expired');
    }
    
    const kiteInstance = new KiteConnect({
      api_key: process.env.KITE_API_KEY,
      access_token: user.zerodhaAuth.accessToken
    });
    
    return kiteInstance;
  }
  
  // Get comprehensive portfolio data
  async getPortfolioData(phoneNumber) {
    try {
      const kite = await this.getUserKiteInstance(phoneNumber);
      
      // Fetch all relevant data in parallel
      const [holdings, positions, margins, orders, trades] = await Promise.all([
        kite.getHoldings().catch(() => []),
        kite.getPositions().catch(() => ({ net: [], day: [] })),
        kite.getMargins().catch(() => null),
        kite.getOrders().catch(() => []),
        kite.getTrades().catch(() => [])
      ]);
      
      // Store trades in database for historical analysis
      if (trades && trades.length > 0) {
        await this.storeTrades(phoneNumber, trades);
      }
      
      // Calculate detailed metrics
      const metrics = this.calculatePortfolioMetrics(holdings, positions, margins);
      
      return {
        success: true,
        data: {
          holdings,
          positions,
          margins,
          orders,
          trades,
          metrics,
          timestamp: new Date()
        }
      };
      
    } catch (error) {
      console.error('Portfolio fetch error:', error);
      return { 
        success: false, 
        error: error.message,
        requiresAuth: error.message.includes('authenticated') || error.message.includes('expired')
      };
    }
  }
  
  // Store trades for historical tracking
  async storeTrades(phoneNumber, trades) {
    for (const trade of trades) {
      await Trade.findOneAndUpdate(
        { tradeId: trade.trade_id },
        {
          phoneNumber,
          tradeId: trade.trade_id,
          orderId: trade.order_id,
          tradedAt: new Date(trade.fill_timestamp || trade.order_timestamp),
          tradingsymbol: trade.tradingsymbol,
          instrumentType: trade.instrument_type,
          side: trade.transaction_type,
          qty: trade.quantity,
          price: trade.price,
          exchange: trade.exchange
        },
        { upsert: true }
      );
    }
  }
  
  // Calculate detailed portfolio metrics
  calculatePortfolioMetrics(holdings, positions, margins) {
    const metrics = {
      holdings: {
        totalValue: 0,
        totalInvestment: 0,
        totalPnL: 0,
        totalPnLPercent: 0,
        count: 0,
        topGainers: [],
        topLosers: []
      },
      positions: {
        totalPnL: 0,
        openCount: 0,
        dayPnL: 0
      },
      overall: {
        totalCapital: 0,
        totalDeployed: 0,
        availableCash: 0,
        utilizationPercent: 0
      }
    };
    
    // Process holdings
    if (holdings && holdings.length > 0) {
      holdings.forEach(holding => {
        const currentValue = holding.quantity * holding.last_price;
        const investment = holding.quantity * holding.average_price;
        const pnl = currentValue - investment;
        const pnlPercent = (pnl / investment) * 100;
        
        metrics.holdings.totalValue += currentValue;
        metrics.holdings.totalInvestment += investment;
        metrics.holdings.totalPnL += pnl;
        metrics.holdings.count++;
        
        // Track top gainers/losers
        const stockData = {
          symbol: holding.tradingsymbol,
          pnl: pnl,
          pnlPercent: pnlPercent,
          currentValue: currentValue
        };
        
        if (pnl > 0) {
          metrics.holdings.topGainers.push(stockData);
        } else {
          metrics.holdings.topLosers.push(stockData);
        }
      });
      
      // Sort and limit top gainers/losers
      metrics.holdings.topGainers.sort((a, b) => b.pnlPercent - a.pnlPercent).slice(0, 3);
      metrics.holdings.topLosers.sort((a, b) => a.pnlPercent - b.pnlPercent).slice(0, 3);
      
      if (metrics.holdings.totalInvestment > 0) {
        metrics.holdings.totalPnLPercent = (metrics.holdings.totalPnL / metrics.holdings.totalInvestment) * 100;
      }
    }
    
    // Process positions
    if (positions && positions.net) {
      positions.net.forEach(position => {
        if (position.quantity !== 0) {
          metrics.positions.openCount++;
          metrics.positions.totalPnL += position.pnl || 0;
        }
      });
      
      if (positions.day) {
        positions.day.forEach(position => {
          metrics.positions.dayPnL += position.pnl || 0;
        });
      }
    }
    
    // Process margins
    if (margins) {
      if (margins.equity) {
        metrics.overall.availableCash = margins.equity.available.cash || 0;
        metrics.overall.totalCapital = margins.equity.net || 0;
      }
      
      metrics.overall.totalDeployed = metrics.holdings.totalValue;
      
      if (metrics.overall.totalCapital > 0) {
        metrics.overall.utilizationPercent = (metrics.overall.totalDeployed / metrics.overall.totalCapital) * 100;
      }
    }
    
    return metrics;
  }
  
  // Get specific stock quote
  async getStockQuote(phoneNumber, symbol, exchange = 'NSE') {
    try {
      const kite = await this.getUserKiteInstance(phoneNumber);
      const instrument = `${exchange}:${symbol.toUpperCase()}`;
      
      const quotes = await kite.getQuote([instrument]);
      return {
        success: true,
        data: quotes[instrument] || null
      };
      
    } catch (error) {
      console.error('Quote fetch error:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Get historical data for analysis
  async getHistoricalData(phoneNumber, symbol, exchange = 'NSE', days = 30) {
    try {
      const kite = await this.getUserKiteInstance(phoneNumber);
      
      // Get instrument token
      const instruments = await kite.getInstruments(exchange);
      const instrument = instruments.find(i => i.tradingsymbol === symbol.toUpperCase());
      
      if (!instrument) {
        return { success: false, error: 'Instrument not found' };
      }
      
      const toDate = new Date();
      const fromDate = new Date(toDate - days * 24 * 60 * 60 * 1000);
      
      const historical = await kite.getHistoricalData(
        instrument.instrument_token,
        'day',
        fromDate,
        toDate
      );
      
      return {
        success: true,
        data: historical
      };
      
    } catch (error) {
      console.error('Historical data error:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Format portfolio for AI with rich context
  formatPortfolioForAI(portfolioData) {
    const { holdings, positions, margins, metrics } = portfolioData;
    
    let formatted = '';
    
    // Portfolio Summary
    formatted += `=== PORTFOLIO SUMMARY ===\n`;
    formatted += `Total Portfolio Value: ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}\n`;
    formatted += `Total Investment: ₹${metrics.holdings.totalInvestment.toLocaleString('en-IN')}\n`;
    formatted += `Total P&L: ₹${metrics.holdings.totalPnL.toLocaleString('en-IN')} (${metrics.holdings.totalPnLPercent.toFixed(2)}%)\n`;
    formatted += `Available Cash: ₹${metrics.overall.availableCash.toLocaleString('en-IN')}\n`;
    formatted += `Capital Utilization: ${metrics.overall.utilizationPercent.toFixed(2)}%\n\n`;
    
    // Holdings Details
    if (holdings && holdings.length > 0) {
      formatted += `=== HOLDINGS (${holdings.length} stocks) ===\n`;
      
      holdings.forEach(holding => {
        const currentValue = holding.quantity * holding.last_price;
        const investment = holding.quantity * holding.average_price;
        const pnl = currentValue - investment;
        const pnlPercent = (pnl / investment) * 100;
        const dayChange = holding.last_price - holding.close_price;
        const dayChangePercent = (dayChange / holding.close_price) * 100;
        
        formatted += `\n${holding.tradingsymbol}:\n`;
        formatted += `  Qty: ${holding.quantity} @ Avg: ₹${holding.average_price.toFixed(2)}\n`;
        formatted += `  Current: ₹${holding.last_price.toFixed(2)} (Day Change: ${dayChangePercent.toFixed(2)}%)\n`;
        formatted += `  Value: ₹${currentValue.toLocaleString('en-IN')}\n`;
        formatted += `  P&L: ₹${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)\n`;
      });
    }
    
    // Active Positions
    if (positions && positions.net && positions.net.length > 0) {
      const activePositions = positions.net.filter(p => p.quantity !== 0);
      if (activePositions.length > 0) {
        formatted += `\n=== ACTIVE POSITIONS ===\n`;
        activePositions.forEach(position => {
          formatted += `${position.tradingsymbol}: ${position.quantity} units, P&L: ₹${position.pnl}\n`;
        });
      }
    }
    
    // Top Performers
    if (metrics.holdings.topGainers.length > 0) {
      formatted += `\n=== TOP GAINERS ===\n`;
      metrics.holdings.topGainers.forEach(stock => {
        formatted += `${stock.symbol}: +${stock.pnlPercent.toFixed(2)}% (₹${stock.pnl.toFixed(2)})\n`;
      });
    }
    
    if (metrics.holdings.topLosers.length > 0) {
      formatted += `\n=== TOP LOSERS ===\n`;
      metrics.holdings.topLosers.forEach(stock => {
        formatted += `${stock.symbol}: ${stock.pnlPercent.toFixed(2)}% (₹${stock.pnl.toFixed(2)})\n`;
      });
    }
    
    formatted += `\n[Data as of ${new Date().toLocaleString('en-IN')}]`;
    
    return formatted;
  }
  
  // Check authentication status
  async requiresAuthentication(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      
      if (!user || !user.zerodhaAuth.isAuthenticated) {
        return true;
      }
      
      if (new Date() > user.zerodhaAuth.expiresAt) {
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Auth check error:', error);
      return true;
    }
  }
}

module.exports = new ZerodhaService();