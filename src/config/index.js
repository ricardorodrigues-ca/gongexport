require('dotenv').config();
const logger = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = [
  'GONG_API_URL',
  'GONG_ACCESS_KEY',
  'GONG_ACCESS_KEY_SECRET'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  const errorMessage = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  logger.error(errorMessage);
  throw new Error(errorMessage);
}

// Log the API URL and masked key for debugging
logger.info(`Using Gong API URL: ${process.env.GONG_API_URL}`);
logger.info(`Access Key available: ${process.env.GONG_ACCESS_KEY ? 'Yes (masked for security)' : 'No'}`);
logger.info(`Access Key Secret available: ${process.env.GONG_ACCESS_KEY_SECRET ? 'Yes (masked for security)' : 'No'}`);

// Create the Basic Auth token as per Gong documentation
const basicToken = Buffer.from(
  `${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`
).toString('base64');

// Check for optional video storage location
const videoStoragePath = process.env.GONG_VIDEO_STORAGE_PATH || null;
if (videoStoragePath) {
  logger.info(`Videos will be saved to custom location: ${videoStoragePath}`);
} else {
  logger.info('Videos will be saved to default location (exports/videos directory)');
}

// Export config object
module.exports = {
  gong: {
    apiUrl: process.env.GONG_API_URL,
    accessKey: process.env.GONG_ACCESS_KEY,
    accessKeySecret: process.env.GONG_ACCESS_KEY_SECRET,
    basicToken: basicToken
  },
  storage: {
    videoPath: videoStoragePath
  }
};