const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  
  // Message Details
  userMessage: {
    content: String,
    timestamp: { type: Date, default: Date.now }
  },
  
  // AI Response Details
  aiResponse: {
    content: String,
    model: String, // 'claude-3-sonnet', 'gpt-4', etc.
    tokensUsed: {
      input: Number,
      output: Number,
      total: Number
    },
    responseTime: Number, // milliseconds
    timestamp: { type: Date, default: Date.now }
  },
  
  // Intent Detection (Key for Gen AI)
  intent: {
    detected: String, // 'portfolio_query', 'authentication', etc.
    confidence: Number,
    entities: [{ 
      type: String, 
      value: String 
    }]
  },
  
  // Session Context
  sessionId: String,
  conversationFlow: String, // 'onboarding', 'authenticated', 'query_handling'
  
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient querying
conversationSchema.index({ phoneNumber: 1, createdAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);