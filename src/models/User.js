const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  firstName: String,
  lastName: String,
  
  // Zerodha Integration
  zerodhaAuth: {
    accessToken: String,
    sessionId: String,
    isAuthenticated: { type: Boolean, default: false },
    authenticatedAt: Date,
    expiresAt: Date
  },
  
  // AI Conversation Context  
  conversationContext: {
    currentTopic: String,
    messageCount: { type: Number, default: 0 },
    lastMessageAt: Date,
    preferences: {
      responseLength: { 
        type: String, 
        enum: ['short', 'medium', 'detailed'], 
        default: 'medium' 
      },
      includeEmojis: { type: Boolean, default: true }
    }
  },
  
  // Usage Analytics (Important for Gen AI)
  usage: {
    totalQueries: { type: Number, default: 0 },
    lastActiveAt: Date,
    subscriptionTier: { 
      type: String, 
      enum: ['free', 'pro'], 
      default: 'free' 
    },
    dailyQueryCount: { type: Number, default: 0 },
    dailyQueryResetAt: Date
  },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);