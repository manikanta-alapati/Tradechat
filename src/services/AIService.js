const { Anthropic } = require('@anthropic-ai/sdk');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

class AIService {
  constructor() {
    this.claude = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
           this.model = 'claude-3-haiku-20240307';

    // Model configuration for different use cases
// Model configuration for different use cases
this.models = {
  conversation: this.model,    // Working model
  intent: this.model,             // Working model  
  analysis: this.modelsame         // Working model
};
  }
  
  // Main method to process user messages
  async processMessage(phoneNumber, userMessage) {
    try {
      console.log(`🤖 Processing message from ${phoneNumber}: ${userMessage}`);
      
      // Get user and conversation history
      const user = await User.findOne({ phoneNumber });
      const conversationHistory = await this.getConversationHistory(phoneNumber);
      
      // Detect intent first
      const intent = await this.detectIntent(userMessage);
      console.log(`🎯 Detected intent: ${intent.intent} (${intent.confidence})`);
      
      // Build context for AI
      const context = this.buildContext(user, conversationHistory, intent);
      
      // Get AI response
      const aiResponse = await this.getAIResponse(userMessage, context);
      
      // Save conversation
      await this.saveConversation(phoneNumber, userMessage, aiResponse, intent);
      
      // Update user stats
      await this.updateUserStats(user);
      
      return {
        response: aiResponse.content,
        intent: intent.intent,
        success: true
      };
      
    } catch (error) {
      console.error('❌ AI Service error:', error);
      throw new Error('AI service temporarily unavailable');
    }
  }
  
  // Detect user intent using AI
  async detectIntent(message) {
    const intentPrompt = `Analyze this WhatsApp message and determine the user's intent. Return ONLY a JSON object.

Message: "${message}"

Possible intents:
- "greeting": Hello, hi, good morning, etc.
- "authentication": Login, connect account, authenticate
- "portfolio_query": Show portfolio, my holdings, P&L, performance
- "stock_quote": Stock price, quote for specific stock
- "help": Help, how to use, instructions
- "done": User completed login process
- "other": Anything else

JSON format:
{"intent": "intent_name", "confidence": 0.95, "entities": [{"type": "stock", "value": "RELIANCE"}]}`;

    try {
      const response = await this.claude.messages.create({
        model: this.models.intent,
        max_tokens: 150,
        messages: [{ role: 'user', content: intentPrompt }]
      });
      
      const result = JSON.parse(response.content[0].text);
      return result;
      
    } catch (error) {
      console.error('Intent detection failed:', error);
      return { intent: 'other', confidence: 0.5, entities: [] };
    }
  }
  
  // Get AI response with context
  async getAIResponse(userMessage, context) {
    const systemPrompt = this.buildSystemPrompt(context);
    
    const startTime = Date.now();
    
    const response = await this.claude.messages.create({
      model: this.models.conversation,
      max_tokens: 1000,
      messages: [
        { 
          role: 'user', 
          content: `${systemPrompt}\n\nUser Message: ${userMessage}` 
        }
      ]
    });
    
    return {
      content: response.content[0].text,
      model: this.models.conversation,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        total: response.usage.input_tokens + response.usage.output_tokens
      },
      responseTime: Date.now() - startTime
    };
  }
  
  // Build system prompt with user context
  // Build system prompt with Zerodha MCP context
buildSystemPrompt(context) {
  let prompt = `You are my personal portfolio analyst with full access to my Zerodha account data.

CAPABILITIES:
- Analyze my specific holdings and positions
- Answer investment questions based on my portfolio
- Provide insights about my stocks' performance
- Compare my holdings with market trends
- Give personalized analysis (not generic advice)

STYLE:
- Concise, direct answers
- Use my actual portfolio numbers
- Personal tone ("your DIXON", "your portfolio")

Always use the current portfolio data provided to answer questions specifically about MY investments.`;

  return prompt;
}
  // Build context object for AI
  buildContext(user, conversationHistory, intent) {
    return {
      user: user || {},
      conversationHistory: conversationHistory || [],
      intent: intent || {},
      timestamp: new Date()
    };
  }
  
  // Get conversation history for context
  async getConversationHistory(phoneNumber, limit = 5) {
    try {
      return await Conversation
        .find({ phoneNumber })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('Error fetching conversation history:', error);
      return [];
    }
  }
  
  // Save conversation to database
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
          entities: intent.entities || []
        },
        sessionId: `session_${phoneNumber}_${Date.now()}`
      });
      
      await conversation.save();
      console.log('💾 Conversation saved');
      
    } catch (error) {
      console.error('Error saving conversation:', error);
    }
  }
  
  // Update user statistics
  async updateUserStats(user) {
    if (!user) return;
    
    try {
      user.usage.totalQueries += 1;
      user.usage.lastActiveAt = new Date();
      user.conversationContext.messageCount += 1;
      user.conversationContext.lastMessageAt = new Date();
      
      await user.save();
      
    } catch (error) {
      console.error('Error updating user stats:', error);
    }
  }
}

module.exports = new AIService();