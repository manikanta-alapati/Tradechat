const { Anthropic } = require('@anthropic-ai/sdk');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const ZerodhaService = require('./ZerodhaService');

class AIService {
  constructor() {
    this.claude = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    this.model = 'claude-3-haiku-20240307';
    
    // Common typos and corrections
    this.typoCorrections = {
      'moee': 'more',
      'mor': 'more',
      'mroe': 'more',
      'protfolio': 'portfolio',
      'portflio': 'portfolio',
      'pnl': 'pnl',
      'pln': 'pnl',
      'pl': 'pnl',
      'profilt': 'profit',
      'loos': 'loss',
      'los': 'loss',
      'bye': 'buy',
      'sel': 'sell',
      'seel': 'sell',
      'holdinsg': 'holdings',
      'holdigns': 'holdings',
      'stok': 'stock',
      'sotck': 'stock',
      'invets': 'invest',
      'investt': 'invest'
    };
  }
  
  // Correct common typos
  correctTypos(message) {
    let corrected = message.toLowerCase();
    
    // Check for common typos
    for (const [typo, correction] of Object.entries(this.typoCorrections)) {
      const regex = new RegExp(`\\b${typo}\\b`, 'gi');
      corrected = corrected.replace(regex, correction);
    }
    
    return corrected;
  }
  
  // Main message processor with typo correction
  async processMessage(phoneNumber, userMessage) {
    try {
      console.log(`🤖 Original message: ${userMessage}`);
      
      // Correct typos
      const correctedMessage = this.correctTypos(userMessage);
      if (correctedMessage !== userMessage.toLowerCase()) {
        console.log(`✏️ Corrected to: ${correctedMessage}`);
      }
      
      // Get user and check authentication
      const user = await User.findOne({ phoneNumber });
      const isAuthenticated = user?.zerodhaAuth?.isAuthenticated;
      
      // Get conversation history for context
      const history = await this.getConversationHistory(phoneNumber);
      
      // Enhanced intent detection with context
      const intent = await this.detectIntentWithContext(userMessage, correctedMessage, history);
      console.log(`🎯 Intent: ${intent.intent} (${intent.confidence})`);
      
      // Get portfolio data if authenticated and relevant
      let portfolioContext = null;
      if (isAuthenticated && this.requiresPortfolioData(intent.intent)) {
        const portfolioResult = await ZerodhaService.getPortfolioData(phoneNumber);
        if (portfolioResult.success) {
          portfolioContext = portfolioResult.data;
        }
      }
      
      // Generate concise response with context
      const response = await this.generateConciseResponse(
        userMessage,
        correctedMessage,
        intent,
        portfolioContext,
        history,
        user
      );
      
      // Save conversation
      await this.saveConversation(phoneNumber, userMessage, response, intent);
      
      return {
        response: response.content,
        intent: intent.intent,
        success: true
      };
      
    } catch (error) {
      console.error('AI Service error:', error);
      return {
        response: "Having trouble understanding. Please try again.",
        intent: 'error',
        success: false
      };
    }
  }
  
  // Enhanced intent detection with conversation context
  async detectIntentWithContext(originalMessage, correctedMessage, history) {
    // Check if this is a follow-up question
    const lastConversation = history && history.length > 0 ? history[0] : null;
    const isFollowUp = this.isFollowUpQuestion(originalMessage, lastConversation);
    
    const intentPrompt = `Analyze this message and determine intent. Consider typos and context.

Original message: "${originalMessage}"
Corrected message: "${correctedMessage}"
${isFollowUp ? `Previous question: "${lastConversation.userMessage.content}"` : ''}
${isFollowUp ? 'This appears to be a follow-up question.' : ''}

Possible intents:
- "clarification": User asking for more info, elaboration (more, what else, tell me more, explain)
- "greeting": Hello, hi, good morning
- "authentication": Login, connect account
- "portfolio_overview": Show portfolio, holdings
- "pnl_query": P&L, profit loss, gains
- "investment_advice": Which stock to buy/invest, investment recommendations
- "stock_specific": Questions about specific stocks
- "performance_analysis": Best/worst performers
- "cash_query": Available cash, funds
- "help": Help, how to use
- "other": Anything else

Return ONLY JSON:
{
  "intent": "intent_name",
  "confidence": 0.95,
  "entities": [{"type": "stock", "value": "SYMBOL"}],
  "isFollowUp": true/false,
  "context": "brief context if follow-up"
}`;

    try {
      const response = await this.claude.messages.create({
        model: this.model,
        max_tokens: 200,
        messages: [{ role: 'user', content: intentPrompt }]
      });
      
      return JSON.parse(response.content[0].text);
      
    } catch (error) {
      console.error('Intent detection error:', error);
      return { 
        intent: 'other', 
        confidence: 0.5, 
        entities: [],
        isFollowUp: false 
      };
    }
  }
  
  // Check if this is a follow-up question
  isFollowUpQuestion(message, lastConversation) {
    if (!lastConversation) return false;
    
    const followUpIndicators = [
      'more', 'what else', 'tell me more', 'explain',
      'why', 'how', 'what about', 'and', 'also',
      'moee', 'mor', 'mroe' // Common typos
    ];
    
    const timeDiff = Date.now() - new Date(lastConversation.createdAt).getTime();
    const isRecent = timeDiff < 5 * 60 * 1000; // Within 5 minutes
    
    const hasIndicator = followUpIndicators.some(indicator => 
      message.toLowerCase().includes(indicator)
    );
    
    return isRecent && (hasIndicator || message.split(' ').length <= 5);
  }
  
  // Generate concise response
  async generateConciseResponse(originalMessage, correctedMessage, intent, portfolioData, history, user) {
    // Build focused prompt for concise responses
    let systemPrompt = `You are a concise Zerodha portfolio assistant. 

CRITICAL RULES:
1. Keep responses SHORT - maximum 3-4 sentences for normal queries
2. Use bullet points for lists (max 3-4 items)
3. Include only essential numbers
4. Skip unnecessary explanations
5. Be direct and actionable
6. Understand typos and context (user typed "${originalMessage}" which likely means "${correctedMessage}")
7. If this is a follow-up question, continue the previous context

User authentication: ${user?.zerodhaAuth?.isAuthenticated ? 'Connected' : 'Not connected'}`;

    // Add portfolio data if available
    if (portfolioData) {
      const formatted = this.formatConcisePortfolioData(portfolioData, intent);
      systemPrompt += `\n\n=== YOUR PORTFOLIO DATA ===\n${formatted}`;
    }
    
    // Add conversation context for follow-ups
    if (intent.isFollowUp && history.length > 0) {
      systemPrompt += `\n\nPrevious exchange:
User: ${history[0].userMessage.content}
You: ${history[0].aiResponse.content.substring(0, 200)}...

User is asking a FOLLOW-UP question. Continue from previous context.`;
    }
    
    // Specific instructions based on intent
    const intentInstructions = this.getIntentSpecificInstructions(intent.intent);
    systemPrompt += `\n\n${intentInstructions}`;
    
    const fullPrompt = `${systemPrompt}

User's actual message: "${originalMessage}"
Understood as: "${correctedMessage}"

Respond in 3-4 sentences MAX. Be helpful but CONCISE.`;

    const response = await this.claude.messages.create({
      model: this.model,
      max_tokens: 500, // Reduced for conciseness
      temperature: 0.3,
      messages: [
        { 
          role: 'user', 
          content: fullPrompt
        }
      ]
    });
    
    return {
      content: response.content[0].text,
      model: this.model,
      tokensUsed: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
        total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
      },
      responseTime: Date.now()
    };
  }
  
  // Format portfolio data concisely based on intent
  formatConcisePortfolioData(portfolioData, intent) {
    const { holdings, metrics, margins } = portfolioData;
    
    // Return only relevant data based on intent
    switch(intent.intent) {
      case 'investment_advice':
        return `
Cash Available: ₹${metrics.overall.availableCash.toLocaleString('en-IN')}
Top Performers: ${metrics.holdings.topGainers.slice(0, 2).map(s => `${s.symbol}(+${s.pnlPercent.toFixed(1)}%)`).join(', ')}
Avoid: ${metrics.holdings.topLosers.slice(0, 1).map(s => `${s.symbol}(${s.pnlPercent.toFixed(1)}%)`).join(', ')}
Portfolio Value: ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}`;
        
      case 'pnl_query':
        return `
Total P&L: ₹${metrics.holdings.totalPnL.toLocaleString('en-IN')} (${metrics.holdings.totalPnLPercent.toFixed(1)}%)
Today's P&L: ₹${metrics.positions.dayPnL.toLocaleString('en-IN')}`;
        
      case 'portfolio_overview':
        return `
Holdings: ${metrics.holdings.count} stocks
Value: ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}
P&L: ₹${metrics.holdings.totalPnL.toLocaleString('en-IN')} (${metrics.holdings.totalPnLPercent.toFixed(1)}%)
Top: ${holdings.slice(0, 3).map(h => h.tradingsymbol).join(', ')}`;
        
      case 'clarification':
        // For follow-ups, provide more detailed data
        return `
Portfolio: ${metrics.holdings.count} stocks worth ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}
Cash: ₹${metrics.overall.availableCash.toLocaleString('en-IN')}
Best: ${metrics.holdings.topGainers.map(s => `${s.symbol}(+${s.pnlPercent.toFixed(1)}%)`).join(', ')}
Worst: ${metrics.holdings.topLosers.map(s => `${s.symbol}(${s.pnlPercent.toFixed(1)}%)`).join(', ')}
Holdings: ${holdings.map(h => `${h.tradingsymbol}(₹${(h.quantity * h.last_price).toLocaleString('en-IN')})`).join(', ')}`;
        
      default:
        // Minimal data for other intents
        return `
Portfolio Value: ₹${metrics.holdings.totalValue.toLocaleString('en-IN')}
P&L: ${metrics.holdings.totalPnLPercent.toFixed(1)}%
Cash: ₹${metrics.overall.availableCash.toLocaleString('en-IN')}`;
    }
  }
  
  // Get intent-specific instructions for concise responses
  getIntentSpecificInstructions(intent) {
    const instructions = {
      'investment_advice': 'Give 2-3 specific stock recommendations with brief reasoning. Mention amount to allocate.',
      'clarification': 'Provide additional details the user is asking for. Reference previous context.',
      'portfolio_overview': 'Quick summary: total value, P&L percentage, top 3 holdings only.',
      'pnl_query': 'State total P&L and percentage. Mention top gainer if positive.',
      'stock_specific': 'Give price, your holding, and P&L for that specific stock only.',
      'performance_analysis': 'List top 2 gainers and 1 loser with percentages.',
      'greeting': 'Brief greeting with one actionable suggestion.',
      'help': 'List 3-4 most useful commands only.'
    };
    
    return instructions[intent] || 'Be direct and concise. Maximum 3 sentences.';
  }
  
  // Check if intent requires portfolio data
  requiresPortfolioData(intent) {
    const portfolioIntents = [
      'portfolio_overview',
      'pnl_query',
      'stock_specific',
      'performance_analysis',
      'cash_query',
      'investment_advice',
      'clarification' // May need data for follow-ups
    ];
    
    return portfolioIntents.includes(intent);
  }
  
  // Get conversation history
  async getConversationHistory(phoneNumber, limit = 3) {
    try {
      return await Conversation
        .find({ phoneNumber })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('Error fetching history:', error);
      return [];
    }
  }
  
  // Save conversation
  async saveConversation(phoneNumber, userMessage, aiResponse, intent) {
    try {
      const conversation = new Conversation({
        phoneNumber,
        userMessage: {
          content: userMessage,
          timestamp: new Date()
        },
        aiResponse: {
          content: aiResponse.content,
          model: aiResponse.model,
          tokensUsed: aiResponse.tokensUsed,
          responseTime: aiResponse.responseTime,
          timestamp: new Date()
        },
        intent: {
          detected: intent.intent,
          confidence: intent.confidence,
          entities: intent.entities || [],
          isFollowUp: intent.isFollowUp || false
        },
        sessionId: `session_${Date.now()}`
      });
      
      await conversation.save();
      
      // Update user stats
      const user = await User.findOne({ phoneNumber });
      if (user) {
        user.usage.totalQueries += 1;
        user.usage.lastActiveAt = new Date();
        user.conversationContext.messageCount += 1;
        user.conversationContext.lastMessageAt = new Date();
        user.conversationContext.currentTopic = intent.intent;
        await user.save();
      }
      
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
  }
}

module.exports = new AIService();