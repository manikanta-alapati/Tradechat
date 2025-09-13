require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Try these models one by one
const modelsToTry = [
  'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229'
];

async function testModels() {
  for (const model of modelsToTry) {
    try {
      console.log(`\nTesting model: ${model}`);
      
      const message = await anthropic.messages.create({
        model: model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say hello' }]
      });
      
      console.log(`✅ ${model} works!`, message.content[0].text);
      return model; // Return the first working model
      
    } catch (error) {
      console.log(`❌ ${model} failed:`, error.message);
    }
  }
  
  console.log('\n❌ No models work. Check your account access.');
}

testModels();