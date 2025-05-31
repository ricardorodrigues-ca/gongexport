#!/usr/bin/env node

/**
 * Trigger script to execute the Gong.io data export
 * This can be run directly from the command line
 */

// Import the export function
const exportGongData = require('./src/export');
const logger = require('./src/utils/logger');

logger.info('Triggered Gong.io data export');

// Execute the export function
exportGongData()
  .then(data => {
    logger.info('Export triggered successfully');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Export trigger failed', { error: error.message });
    process.exit(1);
  });