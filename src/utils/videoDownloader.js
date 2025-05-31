const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const readline = require('readline');

/**
 * Video downloader utility for Gong call recordings
 */
class VideoDownloader {
  /**
   * Create a new VideoDownloader instance
   * @param {string} apiKey The Gong API key
   * @param {string} basicToken The Basic auth token
   * @param {string} customStoragePath Optional custom path to store videos
   * @param {Function} refreshUrlCallback Optional callback to refresh a video URL for a given call ID
   */
  constructor(apiKey, basicToken, customStoragePath = null, refreshUrlCallback = null) {
    this.apiKey = apiKey;
    this.basicToken = basicToken;
    this.customStoragePath = customStoragePath;
    this.refreshUrlCallback = refreshUrlCallback;
    this.rateLimit = {
      callsPerSecond: 2, // Reduced to avoid overwhelming the server
      callsPerDay: 10000,
      currentCalls: 0,
      resetTime: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
      lastCallTime: 0
    };
    
    // Log storage path information
    if (this.customStoragePath) {
      logger.info(`VideoDownloader will save files to custom location: ${this.customStoragePath}`);
    } else {
      logger.info('VideoDownloader will save files to default location');
    }
  }

  /**
   * Download a video from a URL with retry mechanism
   * @param {string} url The video URL to download
   * @param {string} filename The filename to save the video as
   * @param {number} retryCount Number of retries attempted so far (default: 0)
   * @param {number} maxRetries Maximum number of retries to attempt (default: 3)
   * @param {number} retryDelay Base delay between retries in ms (default: 2000)
   * @returns {Promise<string>} Path to the downloaded video file
   */
  async downloadVideo(url, filename, retryCount = 0, maxRetries = 3, retryDelay = 2000) {
    // Validate URL
    if (!url) {
      logger.warn(`Cannot download from empty URL`);
      return null;
    }
    
    // Calculate exponential backoff delay if retrying
    const backoffDelay = retryCount > 0 ? retryDelay * Math.pow(2, retryCount - 1) : 0;

    // Determine the downloads directory
    let downloadsDir;
    if (this.customStoragePath) {
      downloadsDir = this.customStoragePath;
    } else {
      downloadsDir = path.join(__dirname, '../../exports/videos');
    }
    
    // Create the downloads directory if it doesn't exist
    if (!fs.existsSync(downloadsDir)) {
      try {
        fs.mkdirSync(downloadsDir, { recursive: true });
        logger.info(`Created downloads directory at ${downloadsDir}`);
      } catch (error) {
        logger.error(`Failed to create downloads directory at ${downloadsDir}: ${error.message}`);
        throw new Error(`Could not create downloads directory: ${error.message}`);
      }
    }

    // Generate a filename if not provided
    if (!filename) {
      const urlParts = url.split('/');
      filename = urlParts[urlParts.length - 1];
    }

    const filePath = path.join(downloadsDir, filename);
    
    // Check if the file already exists
    if (fs.existsSync(filePath)) {
      logger.info(`Video file already exists at ${filePath}, skipping download`);
      return filePath;
    }

    try {
      // Wait for rate limiting if necessary
      await this.respectRateLimit();

      logger.info(`Downloading video from ${url} to ${filePath}`);
      
      // Try to download the file without authentication first (S3 URLs typically don't need Gong authentication)
      try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream'
        });

        // Get file total size for progress calculation
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastProgressPercentage = 0;
        const startTime = Date.now();
        
        // Initialize the console line for progress bar with file size info
        const fileSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        process.stdout.write(`Downloading ${path.basename(filePath)} (${fileSizeMB} MB) [0%] █`);

        // Create a transform stream to track download progress
        const progressStream = response.data;
        
        // Track download progress
        progressStream.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percentage = Math.floor((downloadedSize / totalSize) * 100);
          
          // Only update when percentage changes by at least 1%
          if (percentage > lastProgressPercentage) {
            lastProgressPercentage = percentage;
            
            // Clear current line
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            
            // Create progress bar with 50 segments
            const progressBarWidth = 50;
            const filledWidth = Math.floor(progressBarWidth * (percentage / 100));
            const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressBarWidth - filledWidth);
            
            // Write progress with download speed calculation
            const elapsedTime = (Date.now() - startTime) / 1000; // seconds
            const speed = downloadedSize / elapsedTime / 1024 / 1024; // MB/s
            const remainingSize = totalSize - downloadedSize;
            const estimatedTimeRemaining = remainingSize / (downloadedSize / elapsedTime);
            const timeRemaining = estimatedTimeRemaining > 0 
              ? `${(estimatedTimeRemaining / 60).toFixed(1)}m remaining` 
              : 'almost done';
            
            process.stdout.write(`Downloading ${path.basename(filePath)} [${percentage}%] ${progressBar} ${speed.toFixed(2)} MB/s (${timeRemaining})`);
          }
        });

        // Save the file
        const writer = fs.createWriteStream(filePath);
        progressStream.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            // Clear line and add a newline after completion
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`Downloaded ${path.basename(filePath)} [100%] Complete`);
            logger.info(`Video successfully downloaded to ${filePath}`);
            resolve(filePath);
          });
          writer.on('error', (err) => {
            // Clear line and add a newline in case of error
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`Download failed for ${path.basename(filePath)}`);
            logger.error(`Error writing video file: ${err.message}`);
            reject(err);
          });
        });
      } catch (directError) {
        // If direct download fails, try with authentication
        logger.info(`Direct download failed, trying with authentication: ${directError.message}`);
        
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          headers: {
            'Authorization': `Basic ${this.basicToken}`
          }
        });

        // Get file total size for progress calculation
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        let lastProgressPercentage = 0;
        const startTime = Date.now();
        
        // Initialize the console line for progress bar with file size info
        const fileSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        process.stdout.write(`Downloading ${path.basename(filePath)} with auth (${fileSizeMB} MB) [0%] █`);

        // Create a transform stream to track download progress
        const progressStream = response.data;
        
        // Track download progress
        progressStream.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const percentage = Math.floor((downloadedSize / totalSize) * 100);
          
          // Only update when percentage changes by at least 1%
          if (percentage > lastProgressPercentage) {
            lastProgressPercentage = percentage;
            
            // Clear current line
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            
            // Create progress bar with 50 segments
            const progressBarWidth = 50;
            const filledWidth = Math.floor(progressBarWidth * (percentage / 100));
            const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressBarWidth - filledWidth);
            
            // Write progress with download speed calculation
            const elapsedTime = (Date.now() - startTime) / 1000; // seconds
            const speed = downloadedSize / elapsedTime / 1024 / 1024; // MB/s
            const remainingSize = totalSize - downloadedSize;
            const estimatedTimeRemaining = remainingSize / (downloadedSize / elapsedTime);
            const timeRemaining = estimatedTimeRemaining > 0 
              ? `${(estimatedTimeRemaining / 60).toFixed(1)}m remaining` 
              : 'almost done';
            
            process.stdout.write(`Downloading ${path.basename(filePath)} with auth [${percentage}%] ${progressBar} ${speed.toFixed(2)} MB/s (${timeRemaining})`);
          }
        });

        // Save the file
        const writer = fs.createWriteStream(filePath);
        progressStream.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            // Clear line and add a newline after completion
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`Downloaded ${path.basename(filePath)} [100%] Complete`);
            logger.info(`Video successfully downloaded to ${filePath}`);
            resolve(filePath);
          });
          writer.on('error', (err) => {
            // Clear line and add a newline in case of error
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`Download failed for ${path.basename(filePath)}`);
            logger.error(`Error writing video file: ${err.message}`);
            reject(err);
          });
        });
      }
    } catch (error) {
      // Handle rate limiting errors
      if (error.response && error.response.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
        logger.warn(`Rate limit exceeded. Retrying after ${retryAfter} seconds.`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.downloadVideo(url, filename); // Retry the download
      }

      // For S3 URLs that return 403 Forbidden or 400 Bad Request
      // Handle S3 access errors with retries
      if ((error.response && 
          (error.response.status === 403 || error.response.status === 400 || error.response.status === 404) && 
          url.includes('s3.amazonaws.com')) || 
          error.message === 'socket hang up' || 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT') {
          
        // Check if we have retries left
        if (retryCount < maxRetries) {
          const nextRetryCount = retryCount + 1;
          const nextDelay = retryDelay * Math.pow(2, retryCount);
          
          logger.warn(`S3 access failed for ${filename}. Retry ${nextRetryCount}/${maxRetries} in ${nextDelay}ms. Error: ${error.message}`);
          
          // Wait for the backoff delay
          await new Promise(resolve => setTimeout(resolve, nextDelay));
          
          // Try to get a fresh URL if this is a Gong S3 URL (they expire)
          // Here we just retry with the same URL since we don't have a mechanism to refresh it
          return this.downloadVideo(url, filename, nextRetryCount, maxRetries, retryDelay);
        } else {
          logger.warn(`Access denied to S3 URL after ${maxRetries} retries: ${url}. These may require special access from Gong.`);
          // Just log this without failing the entire batch
          return null;
        }
      }

      logger.error(`Error downloading video: ${error.message}`);
      
      // For other errors, retry a few times with exponential backoff if we have retries left
      if (retryCount < maxRetries) {
        const nextRetryCount = retryCount + 1;
        const nextDelay = retryDelay * Math.pow(2, retryCount);
        
        logger.warn(`Download failed. Retry ${nextRetryCount}/${maxRetries} in ${nextDelay}ms. Error: ${error.message}`);
        
        // Wait for the backoff delay
        await new Promise(resolve => setTimeout(resolve, nextDelay));
        
        return this.downloadVideo(url, filename, nextRetryCount, maxRetries, retryDelay);
      }
      
      throw error;
    }
  }

  /**
   * Download videos from extensive calls data using embedded video URLs
   * @param {Array} extensiveCalls Array of call objects from extensive API
   * @returns {Promise<Array>} Array of downloaded file paths
   */
  async downloadVideosFromExtensiveCalls(extensiveCalls) {
    if (!extensiveCalls || !Array.isArray(extensiveCalls)) {
      logger.error('No valid extensive calls array provided for video downloads');
      return [];
    }

    logger.info(`Starting download for ${extensiveCalls.length} potential extensive call recordings`);
    console.log(`\n======= Starting download of ${extensiveCalls.length} call videos =======\n`);
    
    const downloadedFiles = [];
    const failedDownloads = [];
    let completedDownloads = 0;
    
    for (const call of extensiveCalls) {
      // Display overall progress
      const totalProgress = Math.floor((completedDownloads / extensiveCalls.length) * 100);
      console.log(`\nOverall Progress: [${completedDownloads}/${extensiveCalls.length}] ${totalProgress}% complete`);
      completedDownloads++;
      try {
        const callId = call.metaData?.id;
        const callTitle = call.metaData?.title || 'Unknown Call';
        
        // Check if the call has a video URL in the media object
        if (!call.media || !call.media.videoUrl) {
          logger.warn(`No video URL available in extensive call data for call ${callId} - "${callTitle}"`);
          failedDownloads.push({
            callId: callId,
            title: callTitle,
            reason: "No video URL in extensive call data"
          });
          continue;
        }
        
        const videoUrl = call.media.videoUrl;
        
        // Extract the meeting start date and time from metadata
        const startedDateTime = call.metaData?.started;
        let formattedDate = '';
        
        if (startedDateTime) {
          try {
            // Format the date as YYYY-MM-DD from ISO string
            const startDate = new Date(startedDateTime);
            formattedDate = startDate.toISOString().split('T')[0]; // Get YYYY-MM-DD part
          } catch (err) {
            logger.warn(`Could not parse date from ${startedDateTime} for call ${callId}`);
          }
        }
        
        // Generate a filename using the call ID, date, and title for uniqueness and organization
        const fileExt = videoUrl.toLowerCase().includes('.mp4') ? '.mp4' : 
                       videoUrl.toLowerCase().includes('.webm') ? '.webm' : '.mp4';
        const filename = `${formattedDate ? formattedDate + '_' : ''}${callId}_${callTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${fileExt}`;
        
        // Try to get a fresh URL if possible (might be implemented on the Gong API side)
        let freshVideoUrl = videoUrl;
        try {
          if (call.metaData?.id && this.refreshUrlCallback) {
            const refreshedUrl = await this.refreshUrlCallback(call.metaData.id);
            if (refreshedUrl) {
              logger.info(`Using refreshed URL for call ${call.metaData.id}`);
              freshVideoUrl = refreshedUrl;
            }
          }
        } catch (refreshError) {
          logger.warn(`Could not refresh URL for call ${call.metaData?.id}: ${refreshError.message}`);
        }
        
        // Download the video using the URL from extensive call data (with retry mechanism)
        const filePath = await this.downloadVideo(freshVideoUrl, filename);
        
        if (filePath) {
          downloadedFiles.push({
            callId: callId,
            title: callTitle,
            filePath: filePath
          });
        } else {
          failedDownloads.push({
            callId: callId,
            title: callTitle,
            reason: "Download returned null"
          });
        }
      } catch (error) {
        const callId = call.metaData?.id || 'unknown';
        const callTitle = call.metaData?.title || 'Unknown Call';
        
        logger.error(`Failed to download video for call ${callId}: ${error.message}`);
        failedDownloads.push({
          callId: callId,
          title: callTitle,
          error: error.message
        });
      }
    }
    
    // Display final progress
    console.log(`\n======= Download Summary =======`);
    console.log(`✅ Successfully downloaded: ${downloadedFiles.length} videos`);
    console.log(`❌ Failed to download: ${failedDownloads.length} videos`);
    console.log(`==============================\n`);
    
    logger.info(`Downloaded ${downloadedFiles.length} video files from extensive call data, failed to download ${failedDownloads.length}`);
    
    // Save failed downloads to a file for reference
    if (failedDownloads.length > 0) {
      const failedDir = path.join(__dirname, '../../exports');
      const failedPath = path.join(failedDir, `failed_video_downloads_${new Date().toISOString().replace(/:/g, '-')}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(failedDownloads, null, 2));
      logger.info(`Saved list of failed downloads to ${failedPath}`);
    }
    
    return downloadedFiles;
  }

  /**
   * Download videos for multiple calls using signed URLs
   * @param {Array} calls Array of call objects from Gong API
   * @param {Object} gongExport The GongExport instance to get signed URLs
   * @returns {Promise<Array>} Array of downloaded file paths
   */
  async downloadVideosForCalls(calls, gongExport) {
    if (!calls || !Array.isArray(calls)) {
      logger.error('No valid calls array provided for video downloads');
      return [];
    }

    if (!gongExport) {
      logger.error('GongExport instance is required to get signed media URLs');
      return [];
    }

    logger.info(`Starting download for ${calls.length} potential call recordings`);
    console.log(`\n======= Starting download of ${calls.length} call videos (standard method) =======\n`);
    
    const downloadedFiles = [];
    const failedDownloads = [];
    let completedDownloads = 0;
    
    for (const call of calls) {
      // Display overall progress
      const totalProgress = Math.floor((completedDownloads / calls.length) * 100);
      console.log(`\nOverall Progress: [${completedDownloads}/${calls.length}] ${totalProgress}% complete`);
      completedDownloads++;
      // Process all calls, using the special Gong endpoint to get signed URLs
      try {
        // First get a signed URL for this call's media
        let signedUrl;
        try {
          // Try using the refresh callback first if available
          if (this.refreshUrlCallback && call.id) {
            signedUrl = await this.refreshUrlCallback(call.id);
          }
          
          // If no refresh callback or it didn't return a URL, use gongExport
          if (!signedUrl) {
            signedUrl = await gongExport.getSignedMediaUrl(call.id);
          }
          
          if (!signedUrl) {
            logger.warn(`No signed media URL available for call ${call.id} - "${call.title}"`);
            failedDownloads.push({
              callId: call.id,
              title: call.title,
              reason: "No signed media URL available"
            });
            continue;
          }
        } catch (error) {
          logger.error(`Failed to get signed media URL for call ${call.id}: ${error.message}`);
          failedDownloads.push({
            callId: call.id,
            title: call.title,
            error: `Failed to get signed URL: ${error.message || 'Unknown error'}`
          });
          continue;
        }
        
        // Try to extract the start date from the call object if available
        let formattedDate = '';
        
        if (call.started) {
          try {
            // Format the date as YYYY-MM-DD from ISO string
            const startDate = new Date(call.started);
            formattedDate = startDate.toISOString().split('T')[0]; // Get YYYY-MM-DD part
          } catch (err) {
            logger.warn(`Could not parse date from ${call.started} for call ${call.id}`);
          }
        }
        
        // Generate a filename using the call ID, date, and title for uniqueness and organization
        const fileExt = signedUrl.toLowerCase().includes('.mp4') ? '.mp4' : 
                       signedUrl.toLowerCase().includes('.webm') ? '.webm' : '.mp4';
        const filename = `${formattedDate ? formattedDate + '_' : ''}${call.id}_${call.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${fileExt}`;
        
        // Download the video using the signed URL
        const filePath = await this.downloadVideo(signedUrl, filename);
        
        if (filePath) {
          downloadedFiles.push({
            callId: call.id,
            title: call.title,
            filePath: filePath
          });
        } else {
          failedDownloads.push({
            callId: call.id,
            title: call.title,
            reason: "Download returned null"
          });
        }
      } catch (error) {
        logger.error(`Failed to download video for call ${call.id}: ${error.message}`);
        failedDownloads.push({
          callId: call.id,
          title: call.title,
          error: error.message
        });
      }
    }

    // Display final progress
    console.log(`\n======= Download Summary (Standard Method) =======`);
    console.log(`✅ Successfully downloaded: ${downloadedFiles.length} videos`);
    console.log(`❌ Failed to download: ${failedDownloads.length} videos`);
    console.log(`==============================\n`);
    
    logger.info(`Downloaded ${downloadedFiles.length} video files, failed to download ${failedDownloads.length}`);
    
    // Save failed downloads to a file for reference
    if (failedDownloads.length > 0) {
      const failedDir = path.join(__dirname, '../../exports');
      const failedPath = path.join(failedDir, `failed_video_downloads_${new Date().toISOString().replace(/:/g, '-')}.json`);
      fs.writeFileSync(failedPath, JSON.stringify(failedDownloads, null, 2));
      logger.info(`Saved list of failed downloads to ${failedPath}`);
    }
    
    return downloadedFiles;
  }

  /**
   * Respect rate limits by implementing a delay if necessary
   * @private
   */
  async respectRateLimit() {
    // Reset the daily counter if past reset time
    if (Date.now() > this.rateLimit.resetTime) {
      this.rateLimit.currentCalls = 0;
      this.rateLimit.resetTime = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now
    }

    // Check if we've exceeded daily limit
    if (this.rateLimit.currentCalls >= this.rateLimit.callsPerDay) {
      const waitTime = this.rateLimit.resetTime - Date.now();
      logger.warn(`Daily rate limit reached. Waiting for ${Math.ceil(waitTime / 1000)} seconds until reset.`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.rateLimit.currentCalls = 0;
    }

    // Calculate time since last call
    const now = Date.now();
    const timeSinceLastCall = now - this.rateLimit.lastCallTime;
    
    // Ensure we respect the calls per second limit (add 50ms buffer)
    const minTimeBetweenCalls = (1000 / this.rateLimit.callsPerSecond) + 50;
    
    if (timeSinceLastCall < minTimeBetweenCalls) {
      const waitTime = minTimeBetweenCalls - timeSinceLastCall;
      logger.debug(`Waiting ${waitTime}ms to respect rate limit`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Update rate limit tracking
    this.rateLimit.lastCallTime = Date.now();
    this.rateLimit.currentCalls++;
  }
}

module.exports = VideoDownloader;