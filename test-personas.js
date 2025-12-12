// Simple test for persona endpoints
const axios = require('axios');

const API_BASE = 'http://localhost:3000';

async function testPersonas() {
  try {
    // Test getting all personas
    const response = await axios.get(`${API_BASE}/api/personas`);
    console.log('✅ Personas endpoint working');
    console.log('Available personas:', response.data.map(p => `${p.name} (${p.id})`));
    
    return response.data;
  } catch (error) {
    console.error('❌ Error testing personas:', error.message);
    return [];
  }
}

if (require.main === module) {
  testPersonas();
}

module.exports = { testPersonas };
