// debug-whitelist.js - Run this to check current whitelist status
import authService from './services/authService.js';

console.log('=== WHITELIST DEBUG ===');
console.log('Current whitelist:', authService.getWhitelist());
console.log('Whitelist length:', authService.getWhitelist().length);

// Test specific emails
const testEmails = [
  'ics.learning.ashoka@gmail.com',
  'aalok.thakkar@ashoka.edu.in',
  'aadi.grover_ug2024@ashoka.edu.in'
];

testEmails.forEach(email => {
  console.log(`${email}: ${authService.isEmailWhitelisted(email) ? 'WHITELISTED' : 'NOT WHITELISTED'}`);
});

