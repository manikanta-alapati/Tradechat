require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const DatabaseManager = require('./utils/database');
const WhatsAppHandler = require('./handlers/WhatsAppHandler');

class TradeChatServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }
  
  setupMiddleware() {
    // Security
    this.app.use(helmet());
    this.app.use(cors());
    
    // Logging
    this.app.use(morgan('combined'));
    
    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP'
    });
    this.app.use(limiter);
  }
  
  setupRoutes() {

    // Add this route in setupRoutes() method
this.app.get('/auth/callback', async (req, res) => {
  try {
    const { request_token, state } = req.query;
    
    if (request_token) {
      // For now, show success and ask user to type "done" in WhatsApp
      // In production, you'd handle this more elegantly
      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>✅ Authentication Successful!</h2>
            <p>Your Zerodha account has been connected to TradeChat.</p>
            <p><strong>Return to WhatsApp and type "done" to complete setup.</strong></p>
            <p>Request Token: ${request_token}</p>
          </body>
        </html>
      `);
      
      // Store request token temporarily (in production, use proper session management)
      global.tempTokens = global.tempTokens || {};
      global.tempTokens[request_token] = {
        timestamp: Date.now(),
        used: false
      };
      
    } else {
      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>❌ Authentication Failed</h2>
            <p>Please try again by typing "login" in WhatsApp.</p>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).send('Authentication error');
  }
});
    // Health check
    this.app.get('/', (req, res) => {
      res.json({
        message: 'TradeChat AI Bot Server',
        status: 'running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });
    
    // WhatsApp webhook endpoint
    this.app.post('/webhook/whatsapp', async (req, res) => {
      await WhatsAppHandler.handleIncomingMessage(req, res);
    });
    
    // Webhook verification for Twilio
    this.app.get('/webhook/whatsapp', (req, res) => {
      WhatsAppHandler.verifyWebhook(req, res);
    });
    
    // API status endpoint
    this.app.get('/api/status', (req, res) => {
      res.json({
        server: 'running',
        database: 'connected',
        ai: 'ready',
        whatsapp: 'ready'
      });
    });
    
    // Test endpoint (development only)
    if (process.env.NODE_ENV === 'development') {
      this.app.post('/api/test-message', async (req, res) => {
        try {
          const { phoneNumber, message } = req.body;
          
          if (!phoneNumber || !message) {
            return res.status(400).json({ error: 'phoneNumber and message required' });
          }
          
          // Simulate WhatsApp message for testing
          const mockReq = {
            body: {
              Body: message,
              From: `whatsapp:+${phoneNumber}`
            }
          };
          
          const mockRes = {
            status: (code) => ({ send: (msg) => res.status(code).json({ response: msg }) })
          };
          
          await WhatsAppHandler.handleIncomingMessage(mockReq, mockRes);
          
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    }
  }
  
  setupErrorHandling() {
  // 404 handler
  this.app.use((req, res, next) => {
    res.status(404).json({
      error: 'Endpoint not found',
      path: req.originalUrl
    });
  });
    
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('❌ Server Error:', error);
      
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });
  }
  
  async start() {
    try {
      // Connect to database
      await DatabaseManager.connect();
      
      // Start server
      this.app.listen(this.port, () => {
        console.log(`🚀 TradeChat server running on port ${this.port}`);
        console.log(`📱 WhatsApp webhook: http://localhost:${this.port}/webhook/whatsapp`);
        console.log(`🔍 Health check: http://localhost:${this.port}/`);
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`🧪 Test endpoint: http://localhost:${this.port}/api/test-message`);
        }
      });
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
  
  // Graceful shutdown
  async stop() {
    try {
      await DatabaseManager.disconnect();
      console.log('✅ Server stopped gracefully');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }
}

// Handle shutdown signals
const server = new TradeChatServer();
process.on('SIGTERM', () => server.stop());
process.on('SIGINT', () => server.stop());

// Start the server
server.start();

module.exports = server;