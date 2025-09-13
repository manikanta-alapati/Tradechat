require('dotenv').config();
const axios = require('axios');

async function testLocalServer() {
  const baseURL = 'http://localhost:3000';
  
  console.log('🧪 Testing TradeChat Local Server...\n');
  
  try {
    // Test 1: Server health check
    console.log('1️⃣ Testing server health...');
    const healthResponse = await axios.get(`${baseURL}/`);
    console.log('✅ Server is running:', healthResponse.data.message);
    
    // Test 2: API status
    console.log('\n2️⃣ Testing API status...');
    const statusResponse = await axios.get(`${baseURL}/api/status`);
    console.log('✅ API Status:', statusResponse.data);
    
    console.log('\n🎉 Core server tests passed!');
    console.log('📱 WhatsApp integration will work when Twilio is configured.');
    console.log('🚀 Ready for Twilio setup!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testLocalServer();