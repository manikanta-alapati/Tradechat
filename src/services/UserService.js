const User = require('../models/User');

class UserService {
  
  // Get or create user
  async getOrCreateUser(phoneNumber) {
    try {
      let user = await User.findOne({ phoneNumber });
      
      if (!user) {
        user = new User({
          phoneNumber,
          conversationContext: {
            messageCount: 0,
            preferences: {
              responseLength: 'medium',
              includeEmojis: true
            }
          },
          usage: {
            totalQueries: 0,
            subscriptionTier: 'free',
            dailyQueryCount: 0,
            dailyQueryResetAt: new Date()
          }
        });
        
        await user.save();
        console.log(`✅ New user created: ${phoneNumber}`);
      }
      
      return user;
      
    } catch (error) {
      console.error('Error getting/creating user:', error);
      throw error;
    }
  }
  
  // Check if user has reached daily limit
  async checkDailyLimit(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      if (!user) return { allowed: true, remaining: 10 };
      
      // Reset daily count if it's a new day
      const now = new Date();
      const resetDate = user.usage.dailyQueryResetAt;
      
      if (!resetDate || now.toDateString() !== resetDate.toDateString()) {
        user.usage.dailyQueryCount = 0;
        user.usage.dailyQueryResetAt = now;
        await user.save();
      }
      
      // Check limits based on subscription tier
      const limits = {
        free: 100,
        pro: 1000
      };
      
      const limit = limits[user.usage.subscriptionTier] || limits.free;
      const remaining = Math.max(0, limit - user.usage.dailyQueryCount);
      
      return {
        allowed: user.usage.dailyQueryCount < limit,
        remaining,
        limit,
        tier: user.usage.subscriptionTier
      };
      
    } catch (error) {
      console.error('Error checking daily limit:', error);
      return { allowed: true, remaining: 10 }; // Default to allowing
    }
  }
  
  // Update daily usage
  async updateDailyUsage(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      if (user) {
        user.usage.dailyQueryCount += 1;
        await user.save();
      }
    } catch (error) {
      console.error('Error updating daily usage:', error);
    }
  }
  
  // Get user stats for analytics
  async getUserStats(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      if (!user) return null;
      
      return {
        totalQueries: user.usage.totalQueries,
        dailyQueries: user.usage.dailyQueryCount,
        subscriptionTier: user.usage.subscriptionTier,
        lastActive: user.usage.lastActiveAt,
        isAuthenticated: user.zerodhaAuth.isAuthenticated,
        memberSince: user.createdAt
      };
      
    } catch (error) {
      console.error('Error getting user stats:', error);
      return null;
    }
  }
}

module.exports = new UserService();