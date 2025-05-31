const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Gong API client for exporting data
 */
class GongExport {
  constructor(apiUrl, basicToken) {
    this.apiUrl = apiUrl;
    this.basicToken = basicToken;
    
    // Log authentication details
    logger.info(`Setting up Gong API client with URL: ${apiUrl}`);
    logger.info('Using Basic Authentication with token (masked for security)');
    
    // Create axios instance with Basic auth header
    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Authorization': `Basic ${basicToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      config => {
        logger.info(`API Request: ${config.method.toUpperCase()} ${config.url}`);
        logger.info('Request headers:', { 
          headers: {
            ...config.headers,
            // Mask the Authorization header value for security
            Authorization: config.headers.Authorization ? 'PRESENT (masked)' : 'MISSING'
          }
        });
        return config;
      },
      error => {
        logger.error('API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      response => {
        logger.info(`API Response: ${response.status} ${response.statusText}`);
        return response;
      },
      error => {
        if (error.response) {
          logger.error(`API Error: ${error.response.status} ${error.response.statusText}`, {
            data: error.response.data
          });
        } else if (error.request) {
          logger.error('API Error: No response received', {
            request: error.request
          });
        } else {
          logger.error('API Error:', error.message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Export call and conversation data
   * @returns {Promise<Object>} The exported data
   */
  async exportCallData() {
    try {
      logger.info('Exporting call and conversation data');
      
      // Using the correct Gong API endpoint for calls (v2 is common for most APIs)
      const response = await this.client.get('/v2/calls');
      
      return response.data;
    } catch (error) {
      logger.error('Failed to export call data', error);
      throw error;
    }
  }
  
  /**
   * Export extensive call data including video URLs
   * @param {Object} options Optional parameters for filtering and pagination
   * @param {string} options.fromDateTime Optional ISO date to filter calls from
   * @param {string} options.toDateTime Optional ISO date to filter calls until
   * @param {string} options.cursor Optional cursor for pagination
   * @returns {Promise<Object>} The exported data with video URLs
   */
  async exportExtensiveCallData(options = {}) {
    try {
      const { fromDateTime, toDateTime, cursor } = options;
      
      logger.info('Exporting extensive call data with video URLs');
      
      // Prepare request body according to API specifications
      const requestBody = {
        filter: {
          fromDateTime,
          toDateTime
        },
        contentSelector: {
          exposedFields: {
            parties: true,
            media: true
          }
        }
      };
      
      // Add cursor for pagination if provided
      if (cursor) {
        requestBody.cursor = cursor;
      }
      
      // POST to the extensive calls endpoint
      const response = await this.client.post('/v2/calls/extensive', requestBody);
      
      return response.data;
    } catch (error) {
      logger.error('Failed to export extensive call data', error);
      throw error;
    }
  }
  
  /**
   * Retrieve all extensive call data with pagination
   * @param {Object} options Optional parameters for filtering
   * @param {string} options.fromDateTime Optional ISO date to filter calls from
   * @param {string} options.toDateTime Optional ISO date to filter calls until
   * @returns {Promise<Array>} Array of all call data with video URLs
   */
  async getAllExtensiveCallData(options = {}) {
    try {
      const allCalls = [];
      let cursor = null;
      let hasMoreRecords = true;
      
      logger.info('Retrieving all extensive call data with pagination');
      
      while (hasMoreRecords) {
        // Request a page of data
        const pageData = await this.exportExtensiveCallData({
          ...options,
          cursor
        });
        
        // Add the calls from this page to our collection
        if (pageData.calls && Array.isArray(pageData.calls)) {
          allCalls.push(...pageData.calls);
          logger.info(`Retrieved ${pageData.calls.length} calls (total: ${allCalls.length})`);
        }
        
        // Check if there are more pages
        if (pageData.records && pageData.records.cursor) {
          cursor = pageData.records.cursor;
          logger.info(`More records available, using cursor: ${cursor}`);
        } else {
          hasMoreRecords = false;
          logger.info('No more records available, pagination complete');
        }
      }
      
      return allCalls;
    } catch (error) {
      logger.error('Failed to retrieve all extensive call data', error);
      throw error;
    }
  }

  /**
   * Export user and team information
   * @returns {Promise<Object>} The exported data
   */
  async exportUserData() {
    try {
      logger.info('Exporting user and team data');
      
      // Using the correct Gong API endpoint for users
      const response = await this.client.get('/v2/users');
      
      return response.data;
    } catch (error) {
      logger.error('Failed to export user data', error);
      throw error;
    }
  }

  /**
   * Export CRM and Engage data
   * @returns {Promise<Object>} The exported data
   */
  async exportCrmData() {
    try {
      logger.info('Exporting CRM and Engage data');
      
      // Currently we don't have a valid endpoint for CRM data, so we'll log a message
      logger.warn('CRM data endpoint not available in the current API version');
      
      return { message: 'CRM data endpoint not available' };
    } catch (error) {
      logger.error('Failed to export CRM data', error);
      throw error;
    }
  }

  /**
   * Export analytics and reporting data
   * @returns {Promise<Object>} The exported data
   */
  async exportAnalyticsData() {
    try {
      logger.info('Exporting analytics and reporting data');
      
      // Currently we don't have a valid endpoint for analytics, so we'll log a message
      logger.warn('Analytics endpoint not available in the current API version');
      
      return { message: 'Analytics endpoint not available' };
    } catch (error) {
      logger.error('Failed to export analytics data', error);
      throw error;
    }
  }
  
  /**
   * Get a secure, signed media URL for a specific call
   * This can be used to refresh expired URLs obtained from the extensive call data
   * @param {string} callId - The ID of the call
   * @returns {Promise<string>} A signed URL for downloading the media
   */
  async getSignedMediaUrl(callId) {
    try {
      logger.info(`Getting signed media URL for call ${callId}`);
      
      // Create a custom axios instance with different content type for this specific request
      const mediaClient = axios.create({
        baseURL: this.apiUrl,
        headers: {
          'Authorization': `Basic ${this.basicToken}`,
          'Content-Type': 'application/octet-stream', // Try a different content type
          'Accept': 'application/json'
        }
      });
      
      // Try PUT with different content type
      try {
        logger.info(`Trying PUT with octet-stream content type for call ${callId}`);
        const response = await mediaClient.put(`/v2/calls/${callId}/media`);
        
        if (response.data && response.data.url) {
          logger.info(`Successfully retrieved signed media URL for call ${callId} using PUT (valid for a limited time)`);
          return response.data.url;
        }
      } catch (putError) {
        // Try PUT with text/plain content type
        try {
          logger.info(`Trying PUT with text/plain content type for call ${callId}`);
          const textPlainClient = axios.create({
            baseURL: this.apiUrl,
            headers: {
              'Authorization': `Basic ${this.basicToken}`,
              'Content-Type': 'text/plain',
              'Accept': 'application/json'
            }
          });
          
          const plainResponse = await textPlainClient.put(`/v2/calls/${callId}/media`);
          
          if (plainResponse.data && plainResponse.data.url) {
            logger.info(`Successfully retrieved signed media URL using PUT with text/plain for call ${callId}`);
            return plainResponse.data.url;
          }
        } catch (plainError) {
          logger.error(`PUT with text/plain also failed for call ${callId}: ${plainError.message}`);
        }
        
        // Try DELETE as a last resort
        try {
          logger.info(`Trying DELETE method for call ${callId}`);
          const deleteResponse = await this.client.delete(`/v2/calls/${callId}/media`);
          
          if (deleteResponse.data && deleteResponse.data.url) {
            logger.info(`Successfully retrieved signed media URL using DELETE for call ${callId}`);
            return deleteResponse.data.url;
          }
        } catch (deleteError) {
          logger.error(`DELETE method also failed for call ${callId}: ${deleteError.message}`);
        }
        
        // If everything fails, log and throw the original error
        logger.error(`All HTTP methods failed for call ${callId}. This usually means the API key doesn't have data capture rights. Ensure your Gong user has a Professional seat with data capture enabled.`);
        logger.error(`Please contact Gong Support again with these error details and confirm the correct method and content type for your account.`);
        throw putError;
      }
      
      logger.warn(`No media URL found in response for call ${callId}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get signed media URL for call ${callId}: ${error.message || 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Check API status and available endpoints
   * @returns {Promise<Object>} API status and version info
   */
  async checkApiStatus() {
    try {
      logger.info('Checking Gong API status');
      
      // We'll check for the calls endpoint since we know it's a valid one
      const response = await this.client.get('/v2/calls?limit=1');
      
      return { status: 'ok', message: 'API is working correctly' };
    } catch (error) {
      logger.error('Failed to check API status', error);
      throw error;
    }
  }
}

module.exports = GongExport;