const mongoose = require('mongoose');

class DatabaseManager {
  constructor() {
    this.connection = null;
  }
  
  async connect() {
    try {
      this.connection = await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      
      console.log('✅ MongoDB connected successfully');
      
      // Connection event listeners
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.log('⚠️ MongoDB disconnected');
      });
      
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      process.exit(1);
    }
  }
  
  async disconnect() {
    if (this.connection) {
      await mongoose.disconnect();
      console.log('📪 MongoDB disconnected');
    }
  }
}

module.exports = new DatabaseManager();