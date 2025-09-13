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
  
  // Main webhook handler for incoming WhatsApp messages
  async handleIncomingMessage(req, res) {
    try {
      const { Body: message, From: from } = req.body;
      const phoneNumber = this.extractPhoneNumber(from);
      
      console.log(`📨 Received message from ${phoneNumber}: ${message}`);
      
      // Get or create user
      const user = await UserService.getOrCreateUser(phoneNumber);
      
      // Check daily limits
      const limitCheck = await UserService.checkDailyLimit(phoneNumber);
      if (!limitCheck.allowed) {
        await this.sendMessage(phoneNumber, this.getLimitExceededMessage(limitCheck));
        return res.status(200).send('OK');
      }
      
      // Process the message
      const response = await this.processMessage(phoneNumber, message, user);
      
      // Send response back to user
      await this.sendMessage(phoneNumber, response);
      
      // Update usage
      await UserService.updateDailyUsage(phoneNumber);
      
      res.status(200).send('OK');
      
    } catch (error) {
      console.error('❌ WhatsApp handler error:', error);
      
      // Send error message to user
      const phoneNumber = this.extractPhoneNumber(req.body.From);
      await this.sendMessage(phoneNumber, "❌ Sorry, I'm having technical difficulties. Please try again in a moment.");
      
      res.status(500).send('Error');
    }
  }
  
  // Process incoming message based on intent
  async processMessage(phoneNumber, message, user) {
    try {
      // Handle "done" specifically (authentication completion)
      if (message.toLowerCase().trim() === 'done') {
        return await this.handleAuthenticationCompletion(phoneNumber, user);
      }
      
      // Check if user needs authentication for portfolio queries
      const requiresAuth = await ZerodhaService.requiresAuthentication(phoneNumber);
      
      // Use AI to detect intent and generate response
      const aiResult = await AIService.processMessage(phoneNumber, message);
      
      // Handle specific intents that require special processing
      switch (aiResult.intent) {
        case 'authentication':
          return await this.handleAuthenticationRequest(phoneNumber, user);
          
        case 'portfolio_query':
          if (requiresAuth) {
            return await this.handleAuthenticationRequest(phoneNumber, user);
          }
          return await this.handlePortfolioQuery(phoneNumber, message);
          
        case 'greeting':
          return this.enhanceGreetingResponse(aiResult.response, user);
          
        default:
          return aiResult.response;
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
      return "❌ I'm having trouble understanding your request. Please try again or type 'help' for assistance.";
    }
  }
  
  // Handle authentication request
  async handleAuthenticationRequest(phoneNumber, user) {
    try {
      const { authURL, sessionId } = ZerodhaService.generateAuthURL(phoneNumber);
      
      // Update user with session ID
      user.zerodhaAuth.sessionId = sessionId;
      await user.save();
      
      return `🔐 *Connect Your Zerodha Account*

Please click the link below to log in to your Zerodha account:

${authURL}

🔹 This will open Zerodha's secure login page
🔹 Enter your User ID, Password, and 2FA
🔹 After successful login, come back here and type *"done"*

🔒 *Your credentials are completely secure and never stored by TradeChat.*`;
      
    } catch (error) {
      console.error('Error handling authentication:', error);
      return "❌ Sorry, I'm having trouble setting up authentication. Please try again.";
    }
  }
  
  // Handle authentication completion
  async handleAuthenticationCompletion(phoneNumber, user) {
    try {
      // Find unused request token from recent authentications
      global.tempTokens = global.tempTokens || {};
      
      let requestToken = null;
      for (const [token, data] of Object.entries(global.tempTokens)) {
        if (!data.used && (Date.now() - data.timestamp) < 300000) { // 5 minutes
          requestToken = token;
          data.used = true;
          break;
        }
      }
      
      if (!requestToken) {
        return "❌ No recent authentication found. Please type 'login' and complete the authentication process again.";
      }
      
      // Complete authentication with Zerodha
      const authResult = await ZerodhaService.authenticateUser(requestToken, phoneNumber);
      
      if (authResult.success) {
        return `✅ *Authentication Successful!*

🎉 Your Zerodha account is now connected to TradeChat!

You can now ask me:
📊 "Show my portfolio"
💰 "What's my P&L today?"
📈 "How is [stock name] performing?"
📋 "Portfolio summary"

What would you like to know about your investments? 🚀`;
      } else {
        return `❌ Authentication failed: ${authResult.error}

Please try typing 'login' again.`;
      }
      
    } catch (error) {
      console.error('Error completing authentication:', error);
      return "❌ Error completing authentication. Please try the login process again.";
    }
  }
  
  // Handle portfolio queries with real data
  async handlePortfolioQuery(phoneNumber, message) {
  // Get fresh portfolio data
  const portfolioResult = await ZerodhaService.getPortfolioData(phoneNumber);
  
  if (!portfolioResult.success) {
    return "Cannot access your portfolio data right now.";
  }
  
  // Format data for AI context
  const portfolioContext = ZerodhaService.formatPortfolioForAI(portfolioResult.data);
  
  // Send question WITH portfolio context to AI
  const enhancedMessage = `${message}

Current Portfolio Data:
${portfolioContext}`;
  
  const aiResponse = await AIService.processMessage(phoneNumber, enhancedMessage);
  return aiResponse.response;
}
  // Enhance greeting response with user context
  enhanceGreetingResponse(aiResponse, user) {
    const isNewUser = user.usage.totalQueries === 0;
    const isAuthenticated = user.zerodhaAuth.isAuthenticated;
    
    if (isNewUser) {
      return `👋 Welcome to *TradeChat*!

I'm your personal Zerodha portfolio assistant. I can help you:

📊 Check your portfolio performance
💰 View P&L and holdings  
📈 Get stock insights and analysis
🔍 Track your investments

🚀 *Get Started:* Type 'login' to connect your Zerodha account!

Type 'help' anytime for assistance.`;
    }
    
    if (isAuthenticated) {
      return `${aiResponse}

📊 Your account is connected! Try asking:
- "Show my portfolio"
- "Today's P&L"
- "Best performing stock"`;
    }
    
    return `${aiResponse}

🔐 Type 'login' to connect your Zerodha account and get started!`;
  }
  
  // Get limit exceeded message
  getLimitExceededMessage(limitCheck) {
    return `🚫 *Daily Limit Reached*

You've used all ${limitCheck.limit} queries for today (${limitCheck.tier} plan).

💎 *Upgrade to Pro* for unlimited queries!
🔄 *Free plan resets* tomorrow

Type 'upgrade' to learn about Pro features.`;
  }
  
  // Send WhatsApp message via Twilio
  async sendMessage(phoneNumber, message) {
    try {
      // Skip actual sending in development/test mode if Twilio not configured
      if (process.env.NODE_ENV === 'development' && 
          (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'your_twilio_sid')) {
        console.log(`📱 [TEST MODE] Would send to ${phoneNumber}: ${message.substring(0, 50)}...`);
        return { sid: 'test_message_id' };
      }
      
      const result = await this.twilioClient.messages.create({
        body: message,
        from: this.fromNumber,
        to: `whatsapp:+${phoneNumber}`
      });
      
      console.log(`✅ Message sent to ${phoneNumber}: ${message.substring(0, 50)}...`);
      return result;
      
    } catch (error) {
      console.error('❌ Error sending WhatsApp message:', error);
      throw error;
    }
  }
  
  // Extract phone number from WhatsApp format
  extractPhoneNumber(whatsappNumber) {
    // Convert "whatsapp:+919876543210" to "919876543210"
    return whatsappNumber.replace('whatsapp:+', '');
  }
  
  // Webhook verification (required by Twilio)
  verifyWebhook(req, res) {
    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  }
}

module.exports = new WhatsAppHandler();