#!/usr/bin/env node

/**
 * API discovery script for Gong.io
 * This script attempts to identify valid API endpoints
 */

require('dotenv').config();
const axios = require('axios');

// Create Basic Auth token
const basicToken = Buffer.from(
  `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
).toString('base64');

// Create axios client with Basic auth
const client = axios.create({
  baseURL: process.env.GONG_API_URL,
  headers: {
    'Authorization': `Basic ${basicToken}`,
    'Content-Type': 'application/json'
  }
});

// Array of endpoints to test
const endpoints = [
  '/',
  '/v1',
  '/v2',
  '/v1/calls',
  '/v2/calls',
  '/v1/users',
  '/v2/users',
  '/stats',
  '/api',
  '/api/v1',
  '/api/v2',
  '/api/calls',
  '/api/users',
  '/metadata'
];

// Test each endpoint
async function discoverEndpoints() {
  console.log('Gong API Endpoint Discovery');
  console.log('==========================');
  console.log(`Using API URL: ${process.env.GONG_API_URL}`);
  console.log('Testing endpoints...\n');

  for (const endpoint of endpoints) {
    try {
      console.log(`Testing ${endpoint}...`);
      const response = await client.get(endpoint);
      console.log(`✅ SUCCESS: ${endpoint} - Status: ${response.status}`);
      console.log('Response data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        console.log(`❌ FAIL: ${endpoint} - Status: ${error.response.status}`);
        if (error.response.data) {
          console.log('Error data:', JSON.stringify(error.response.data, null, 2));
        }
      } else {
        console.log(`❌ FAIL: ${endpoint} - Error: ${error.message}`);
      }
    }
    console.log('---');
  }
}

// Run the discovery
discoverEndpoints()
  .then(() => {
    console.log('API discovery completed.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error during API discovery:', error);
    process.exit(1);
  });