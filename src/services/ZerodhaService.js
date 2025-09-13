const { KiteConnect } = require('kiteconnect');
const User = require('../models/User');
const crypto = require('crypto');

class ZerodhaService {
  constructor() {
    this.kite = new KiteConnect({
      api_key: process.env.KITE_API_KEY
    });
  }
  
  // Generate real Kite Connect authentication URL
  generateAuthURL(phoneNumber) {
    const sessionId = `session_${phoneNumber}_${Date.now()}`;
    const authURL = this.kite.getLoginURL();
    
    return {
      authURL,
      sessionId
    };
  }
  
  // Complete authentication with request token
  async authenticateUser(requestToken, phoneNumber) {
    try {
      const response = await this.kite.generateSession(
        requestToken, 
        process.env.KITE_API_SECRET
      );
      
      // Store authentication in database
      const user = await User.findOne({ phoneNumber });
      if (user) {
        user.zerodhaAuth = {
          accessToken: response.access_token,
          userId: response.user_id,
          isAuthenticated: true,
          authenticatedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
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
  
  // Get real portfolio data
  async getPortfolioData(phoneNumber) {
  try {
    const user = await User.findOne({ phoneNumber });
    
    if (!user || !user.zerodhaAuth.isAuthenticated) {
      return { 
        success: false, 
        error: 'User not authenticated',
        requiresAuth: true 
      };
    }
    
    // Check if token is expired
    if (new Date() > user.zerodhaAuth.expiresAt) {
      return { 
        success: false, 
        error: 'Session expired',
        requiresAuth: true 
      };
    }
    
    // Set access token and fetch real data
    this.kite.setAccessToken(user.zerodhaAuth.accessToken);
    
    // Call APIs individually with proper error handling
    const holdings = await this.kite.getHoldings();
    const positions = await this.kite.getPositions();
    const margins = await this.kite.getMargins();
    
    return {
      success: true,
      data: { holdings, positions, margins }
    };
    
  } catch (error) {
    console.error('Detailed portfolio error:', error);
    
    // Check if it's an authentication error
    if (error.message && error.message.includes('Invalid token')) {
      return { 
        success: false, 
        error: 'Session expired',
        requiresAuth: true 
      };
    }
    
    return { success: false, error: error.message };
  }
}
  
  // Format real portfolio data for display
  formatPortfolioForAI(portfolioData) {
    const { holdings, positions, margins } = portfolioData;
    
    let formatted = `📊 Your Live Zerodha Portfolio:\n\n`;
    
    // Format holdings
    if (holdings && holdings.length > 0) {
      formatted += `💼 Holdings:\n`;
      let totalValue = 0;
      let totalPnL = 0;
      
      holdings.forEach(holding => {
        const currentValue = holding.quantity * holding.last_price;
        const pnl = holding.pnl || 0;
        const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
        
        formatted += `${pnlEmoji} ${holding.tradingsymbol}: ${holding.quantity} @ ₹${holding.last_price} (P&L: ₹${pnl.toFixed(2)})\n`;
        
        totalValue += currentValue;
        totalPnL += pnl;
      });
      
      formatted += `\n💰 Total Value: ₹${totalValue.toLocaleString()}\n`;
      formatted += `📈 Total P&L: ₹${totalPnL.toFixed(2)}\n\n`;
    }
    
    // Format positions if any
    if (positions && positions.net && positions.net.length > 0) {
      const activePositions = positions.net.filter(pos => pos.quantity !== 0);
      if (activePositions.length > 0) {
        formatted += `⚡ Active Positions:\n`;
        activePositions.forEach(position => {
          const pnlEmoji = position.pnl >= 0 ? '🟢' : '🔴';
          formatted += `${pnlEmoji} ${position.tradingsymbol}: ${position.quantity} (P&L: ₹${position.pnl})\n`;
        });
        formatted += `\n`;
      }
    }
    
    // Format margins
    if (margins && margins.equity) {
      formatted += `💳 Available Cash: ₹${margins.equity.available.cash.toLocaleString()}\n`;
    }
    
    formatted += `\n🕐 Last Updated: ${new Date().toLocaleString()}`;
    
    return formatted;
  }
  
  // Check if user needs authentication
  async requiresAuthentication(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      
      if (!user || !user.zerodhaAuth.isAuthenticated) {
        return true;
      }
      
      // Check if token is expired
      if (new Date() > user.zerodhaAuth.expiresAt) {
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Error checking auth requirement:', error);
      return true;
    }
  }
}

module.exports = new ZerodhaService();