// test.js - Enhanced debugging version
import { parseIntent } from './index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  // Check if API key exists
  if (!process.env.OPEN_AI_KEY) {
    console.log('❌ Error: OPENAI_API_KEY not found in environment variables');
    console.log('Make sure you have a .env file with OPENAI_API_KEY=sk-...');
    return;
  }
  
  console.log('🔑 API Key found:', process.env.OPEN_AI_KEY.substring(0, 10) + '...');

  const inputs = [
    "Set my weekly budget to 15,000 USD",
    "I want to budget ₦50,000 monthly",
    "Set budget to $200 per week"
  ];

  for (const input of inputs) {
    console.log('\n📝 Input:', input);
    console.log('⏳ Processing...');
    
    try {
      const intent = await parseIntent(input);
      console.log('✅ Parsed:', JSON.stringify(intent, null, 2));
    } catch (error) {
      // Enhanced error logging
      console.log('❌ Error occurred:');
      console.log('   Message:', error.message);
      console.log('   Type:', error.constructor.name);
      
      // Log full error object for debugging
      if (error.response) {
        console.log('   API Response:', error.response.status, error.response.statusText);
        console.log('   API Data:', error.response.data);
      }
      
      if (error.stack) {
        console.log('   Stack:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      
      // Check for common issues
      if (error.message.includes('API key')) {
        console.log('💡 Hint: Check your OPENAI_API_KEY in .env file');
      }
      
      if (error.message.includes('rate limit')) {
        console.log('💡 Hint: You hit the rate limit. Wait and try again.');
      }
      
      if (error.message.includes('network') || error.message.includes('fetch')) {
        console.log('💡 Hint: Check your internet connection');
      }
    }
  }
}

main().catch((error) => {
  console.error('🚨 Unhandled error in main:', error);
});