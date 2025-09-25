const twilio = require('twilio');
const AIService = require('../services/AIService');
const ZerodhaService = require('../services/ZerodhaService');
const UserService = require('../services/UserService');

class WhatsAppHandler {
  constructor() {
    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    this.fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  }
  
  // Main webhook handler
  async handleIncomingMessage(req, res) {
    try {
      const { Body: message, From: from } = req.body;
      const phoneNumber = this.extractPhoneNumber(from);
      
      console.log(`📨 Message from ${phoneNumber}: ${message}`);
      
      // Get or create user
      const user = await UserService.getOrCreateUser(phoneNumber);
      
      // Check daily limits
      const limitCheck = await UserService.checkDailyLimit(phoneNumber);
      if (!limitCheck.allowed) {
        await this.sendMessage(phoneNumber, this.getLimitExceededMessage(limitCheck));
        return res.status(200).send('OK');
      }
      
      // Process with AI
      const response = await this.processWithAI(phoneNumber, message, user);
      
      // Send response
      await this.sendMessage(phoneNumber, response);
      
      // Update usage
      await UserService.updateDailyUsage(phoneNumber);
      
      res.status(200).send('OK');
      
    } catch (error) {
      console.error('❌ Handler error:', error);
      
      const phoneNumber = this.extractPhoneNumber(req.body.From);
      await this.sendMessage(phoneNumber, "❌ Technical issue. Please try again.");
      
      res.status(500).send('Error');
    }
  }
  
  // Process message with AI and portfolio context
  async processWithAI(phoneNumber, message, user) {
    try {
      // Handle special commands
      const cleanMessage = message.toLowerCase().trim();
      
      // Authentication flow
      if (cleanMessage === 'login' || cleanMessage === 'connect') {
        return await this.handleAuthenticationRequest(phoneNumber, user);
      }
      
      if (cleanMessage === 'done') {
        return await this.handleAuthenticationCompletion(phoneNumber, user);
      }
      
      // Quick commands
      if (cleanMessage === 'portfolio' || cleanMessage === 'p') {
        return await this.getQuickPortfolioSummary(phoneNumber);
      }
      
      if (cleanMessage === 'pnl' || cleanMessage === 'profit') {
        return await this.getQuickPnL(phoneNumber);
      }
      
      if (cleanMessage === 'help') {
        return this.getHelpMessage(user);
      }
      
      // Check authentication for portfolio queries
      const requiresAuth = await ZerodhaService.requiresAuthentication(phoneNumber);
      if (requiresAuth && this.isPortfolioQuery(message)) {
        return `🔐 Please connect your Zerodha account first.\n\nType "login" to get started.`;
      }
      
      // Process with AI (which will fetch portfolio data if needed)
      const aiResult = await AIService.processMessage(phoneNumber, message);
      
      // Handle special intents
      if (aiResult.intent === 'authentication') {
        return await this.handleAuthenticationRequest(phoneNumber, user);
      }
      
      return aiResult.response;
      
    } catch (error) {
      console.error('Processing error:', error);
      return "❌ I'm having trouble understanding. Try:\n• 'portfolio' - View holdings\n• 'pnl' - Check profit/loss\n• 'help' - Get assistance";
    }
  }
  
  // Check if message is portfolio-related
  isPortfolioQuery(message) {
    const portfolioKeywords = [
      'portfolio', 'holdings', 'stocks', 'pnl', 'profit', 'loss',
      'performance', 'investment', 'value', 'cash', 'margin'
    ];
    
    const lowerMessage = message.toLowerCase();
    return portfolioKeywords.some(keyword => lowerMessage.includes(keyword));
  }
  
  // Quick portfolio summary
  async getQuickPortfolioSummary(phoneNumber) {
    const portfolioResult = await ZerodhaService.getPortfolioData(phoneNumber);
    
    if (!portfolioResult.success) {
      if (portfolioResult.requiresAuth) {
        return `🔐 Please login first. Type "login" to connect your Zerodha account.`;
      }
      return `❌ Unable to fetch portfolio. Please try again.`;
    }
    
    const { metrics, holdings } = portfolioResult.data;
    const pnlEmoji = metrics.holdings.totalPnL >= 0 ? '🟢' : '🔴';
    
    let response = `📊 *Your Portfolio*\n\n`;
    response += `💼 Holdings: ${metrics.holdings.count} stocks\n`;
    response += `💰 Total Value: ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}\n`;
    response += `${pnlEmoji} P&L: ₹${metrics.holdings.totalPnL.toLocaleString('en-IN')} (${metrics.holdings.totalPnLPercent.toFixed(2)}%)\n`;
    response += `💳 Cash: ₹${metrics.overall.availableCash.toLocaleString('en-IN')}\n\n`;
    
    // Top 3 holdings
    if (holdings && holdings.length > 0) {
      const topHoldings = holdings
        .sort((a, b) => (b.quantity * b.last_price) - (a.quantity * a.last_price))
        .slice(0, 3);
      
      response += `*Top Holdings:*\n`;
      topHoldings.forEach(h => {
        const value = h.quantity * h.last_price;
        const pnl = value - (h.quantity * h.average_price);
        const emoji = pnl >= 0 ? '📈' : '📉';
        response += `${emoji} ${h.tradingsymbol}: ₹${value.toLocaleString('en-IN')}\n`;
      });
    }
    
    response += `\n💡 Ask me about any specific stock or analysis!`;
    
    return response;
  }
  
  // Quick P&L summary
  async getQuickPnL(phoneNumber) {
    const portfolioResult = await ZerodhaService.getPortfolioData(phoneNumber);
    
    if (!portfolioResult.success) {
      if (portfolioResult.requiresAuth) {
        return `🔐 Please login first. Type "login" to connect your Zerodha account.`;
      }
      return `❌ Unable to fetch P&L. Please try again.`;
    }
    
    const { metrics } = portfolioResult.data;
    const overallEmoji = metrics.holdings.totalPnL >= 0 ? '🟢' : '🔴';
    
    let response = `💰 *P&L Summary*\n\n`;
    response += `${overallEmoji} *Total P&L:* ₹${metrics.holdings.totalPnL.toLocaleString('en-IN')}\n`;
    response += `📊 *Returns:* ${metrics.holdings.totalPnLPercent.toFixed(2)}%\n`;
    response += `📈 *Investment:* ₹${metrics.holdings.totalInvestment.toLocaleString('en-IN')}\n`;
    response += `💼 *Current Value:* ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}\n\n`;
    
    if (metrics.holdings.topGainers.length > 0) {
      response += `*🚀 Top Gainers:*\n`;
      metrics.holdings.topGainers.forEach(s => {
        response += `• ${s.symbol}: +${s.pnlPercent.toFixed(2)}% (₹${s.pnl.toLocaleString('en-IN')})\n`;
      });
    }
    
    if (metrics.holdings.topLosers.length > 0) {
      response += `\n*📉 Underperformers:*\n`;
      metrics.holdings.topLosers.forEach(s => {
        response += `• ${s.symbol}: ${s.pnlPercent.toFixed(2)}% (₹${s.pnl.toLocaleString('en-IN')})\n`;
      });
    }
    
    if (metrics.positions.dayPnL !== 0) {
      const dayEmoji = metrics.positions.dayPnL >= 0 ? '📈' : '📉';
      response += `\n${dayEmoji} *Today's P&L:* ₹${metrics.positions.dayPnL.toLocaleString('en-IN')}`;
    }
    
    return response;
  }
  
  // Handle authentication request
  async handleAuthenticationRequest(phoneNumber, user) {
    try {
      const { authURL, sessionId } = ZerodhaService.generateAuthURL(phoneNumber);
      
      user.zerodhaAuth.sessionId = sessionId;
      await user.save();
      
      return `🔐 *Connect Your Zerodha Account*

Click here to login: ${authURL}

After login:
1. Complete 2FA on Zerodha
2. You'll see a success page
3. Come back here and type *"done"*

🔒 Your credentials are secure and never stored.`;
      
    } catch (error) {
      console.error('Auth error:', error);
      return "❌ Authentication setup failed. Please try again.";
    }
  }
  
  // Handle authentication completion
  async handleAuthenticationCompletion(phoneNumber, user) {
    try {
      // Check for recent request token
      global.tempTokens = global.tempTokens || {};
      
      let requestToken = null;
      for (const [token, data] of Object.entries(global.tempTokens)) {
        if (!data.used && (Date.now() - data.timestamp) < 300000) {
          requestToken = token;
          data.used = true;
          break;
        }
      }
      
      if (!requestToken) {
        return "❌ No recent login found. Please type 'login' and try again.";
      }
      
      const authResult = await ZerodhaService.authenticateUser(requestToken, phoneNumber);
      
      if (authResult.success) {
        // Fetch initial portfolio data
        const portfolio = await ZerodhaService.getPortfolioData(phoneNumber);
        
        let welcomeMsg = `✅ *Successfully Connected!*\n\n`;
        
        if (portfolio.success && portfolio.data.holdings) {
          welcomeMsg += `🎉 I can now access your Zerodha portfolio!\n\n`;
          welcomeMsg += `📊 You have ${portfolio.data.holdings.length} stocks in your portfolio.\n\n`;
        }
        
        welcomeMsg += `Try these commands:\n`;
        welcomeMsg += `• "portfolio" - View holdings\n`;
        welcomeMsg += `• "pnl" - Check profit/loss\n`;
        welcomeMsg += `• "How is TCS doing?" - Stock analysis\n`;
        welcomeMsg += `• "Top gainers" - Best performers\n\n`;
        welcomeMsg += `What would you like to know?`;
        
        return welcomeMsg;
      } else {
        return `❌ Authentication failed: ${authResult.error}\n\nPlease type 'login' to try again.`;
      }
      
    } catch (error) {
      console.error('Auth completion error:', error);
      return "❌ Error completing authentication. Please try again.";
    }
  }
  
  // Get help message
  getHelpMessage(user) {
    const isAuthenticated = user?.zerodhaAuth?.isAuthenticated;
    
    let help = `🤖 *TradeChat Help*\n\n`;
    
    if (isAuthenticated) {
      help += `✅ Your account is connected!\n\n`;
      help += `*Available Commands:*\n`;
      help += `📊 "portfolio" - View all holdings\n`;
      help += `💰 "pnl" - Check profit/loss\n`;
      help += `📈 "[Stock] analysis" - e.g., "TCS analysis"\n`;
      help += `🔝 "top gainers" - Best performers\n`;
      help += `📉 "losers" - Underperformers\n`;
      help += `💳 "cash" - Available funds\n\n`;
      help += `*Natural Queries:*\n`;
      help += `• "How's my portfolio doing?"\n`;
      help += `• "Should I hold RELIANCE?"\n`;
      help += `• "What's my biggest position?"\n`;
      help += `• "Show today's performance"\n`;
    } else {
      help += `🔐 Connect your Zerodha account to start!\n\n`;
      help += `Type *"login"* to connect your account.\n\n`;
      help += `Once connected, I can:\n`;
      help += `• Show your real-time portfolio\n`;
      help += `• Track P&L and returns\n`;
      help += `• Analyze individual stocks\n`;
      help += `• Provide personalized insights\n`;
    }
    
    return help;
  }
  
  // Get limit exceeded message
  getLimitExceededMessage(limitCheck) {
    return `🚫 *Daily Limit Reached*

You've used ${limitCheck.limit} queries today.

💎 Upgrade to Pro for unlimited access!
🔄 Free tier resets tomorrow.

Type 'upgrade' for Pro features.`;
  }
  
  // Send WhatsApp message
  async sendMessage(phoneNumber, message) {
    try {
      if (process.env.NODE_ENV === 'development' && 
          (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'your_twilio_sid')) {
        console.log(`📱 [TEST] To ${phoneNumber}: ${message.substring(0, 100)}...`);
        return { sid: 'test_message_id' };
      }
      
      const result = await this.twilioClient.messages.create({
        body: message,
        from: this.fromNumber,
        to: `whatsapp:+${phoneNumber}`
      });
      
      console.log(`✅ Sent to ${phoneNumber}`);
      return result;
      
    } catch (error) {
      console.error('❌ Send error:', error);
      throw error;
    }
  }
  
  // Extract phone number
  extractPhoneNumber(whatsappNumber) {
    return whatsappNumber.replace('whatsapp:+', '');
  }
  
  // Webhook verification
  verifyWebhook(req, res) {
    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
}

module.exports = new WhatsAppHandler();