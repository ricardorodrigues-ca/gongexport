const logger = require('./utils/logger');
const config = require('./config');
const GongExport = require('./api/gongExport');
const VideoDownloader = require('./utils/videoDownloader');
const fs = require('fs');
const path = require('path');

// Function to save data to a file
const saveToFile = (data, filename) => {
  const exportDir = path.join(__dirname, '../exports');
  const filePath = path.join(exportDir, filename);
  
  // Ensure exports directory exists
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  
  // Add timestamp to data
  const dataToSave = {
    exportTimestamp: new Date().toISOString(),
    data
  };
  
  // Save to file
  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
  logger.info(`Data saved to ${filePath}`);
  
  return filePath;
};

/**
 * Main export function to retrieve data from Gong.io API
 */
async function exportGongData() {
  logger.info('Starting Gong.io data export process');
  
  try {
    // Initialize Gong API client
    const gongExport = new GongExport(
      config.gong.apiUrl,
      config.gong.basicToken
    );
    
    // Check API status first
    try {
      const apiStatus = await gongExport.checkApiStatus();
      logger.info('Gong API is available', { status: apiStatus });
    } catch (error) {
      logger.error('Unable to connect to Gong API, please check credentials and API URL');
      throw new Error('Failed to connect to Gong API');
    }
    
    // Export different types of data
    const exportedData = {};

    try {
      // Export and save call data
      exportedData.calls = await gongExport.exportCallData();
      saveToFile(exportedData.calls, `calls_${new Date().toISOString().replace(/:/g, '-')}.json`);
      logger.info('Successfully exported call data');
      
      // NOTE: Uncomment the following lines if you have the necessary API scopes
      // (requires api:calls:read:extensive and api:calls:read:media-url scopes)
      // 
      // try {
      //   const callsWithMedia = await gongExport.exportCallDataWithMedia();
      //   saveToFile(callsWithMedia, `calls_with_media_${new Date().toISOString().replace(/:/g, '-')}.json`);
      //   logger.info('Successfully exported call data with media URLs');
      //   exportedData.callsWithMedia = callsWithMedia;
      // } catch (error) {
      //   logger.error('Failed to export call data with media URLs, verify your API credentials have the required scopes');
      // }
      
      // Set this to false to disable video download attempts
      const enableVideoDownloads = true;
      
      // Export extensive call data with video URLs
      try {
        logger.info('Trying to export extensive call data which includes video URLs');
        
        // Set the date range for the last 90 days by default (to get more historical data)
        const toDateTime = new Date().toISOString();
        const fromDateTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        
        logger.info(`Retrieving extensive call data from ${fromDateTime} to ${toDateTime}`);
        
        // Get all extensive call data with pagination
        const extensiveCalls = await gongExport.getAllExtensiveCallData({
          fromDateTime,
          toDateTime
        });
        
        if (extensiveCalls && extensiveCalls.length > 0) {
          logger.info(`Successfully retrieved ${extensiveCalls.length} calls with extensive data`);
          
          // Save the extensive call data
          saveToFile(extensiveCalls, `extensive_calls_${new Date().toISOString().replace(/:/g, '-')}.json`);
          exportedData.extensiveCalls = extensiveCalls;
          
          // Download videos if enabled
          if (enableVideoDownloads) {
            logger.info(`Found ${extensiveCalls.length} calls with extensive data, attempting to download videos`);
            
            // Initialize video downloader with custom storage path if configured
            // Pass a URL refresh callback to handle expired S3 URLs
            const videoDownloader = new VideoDownloader(
              config.gong.accessKey,
              config.gong.basicToken,
              config.storage.videoPath,
              async (callId) => {
                try {
                  // Try to get a fresh URL for this call ID
                  const refreshedUrl = await gongExport.getSignedMediaUrl(callId);
                  if (refreshedUrl) {
                    logger.info(`Successfully refreshed URL for call ${callId}`);
                    return refreshedUrl;
                  }
                } catch (error) {
                  logger.warn(`Failed to refresh URL for call ${callId}: ${error.message}`);
                }
                return null;
              }
            );
            
            // Download videos using the videoUrl field from extensive data
            try {
              const downloadedVideos = await videoDownloader.downloadVideosFromExtensiveCalls(extensiveCalls);
              exportedData.videoDownloads = downloadedVideos;
              
              if (downloadedVideos.length > 0) {
                logger.info(`Downloaded ${downloadedVideos.length} videos from extensive call data`);
                saveToFile(downloadedVideos, `video_downloads_${new Date().toISOString().replace(/:/g, '-')}.json`);
                
                // Add note to the combined export about video downloads
                exportedData.videoDownloadSummary = {
                  totalCalls: extensiveCalls.length,
                  successfulDownloads: downloadedVideos.length,
                  videoDirectory: config.storage.videoPath || path.join(__dirname, '../exports/videos'),
                  method: "extensive_calls_api"
                };
              } else {
                logger.info('No videos were successfully downloaded from extensive call data');
                
                // Add note to the combined export about video downloads
                exportedData.videoDownloadSummary = {
                  totalCalls: extensiveCalls.length,
                  successfulDownloads: 0,
                  method: "extensive_calls_api",
                  note: "Check failed_video_downloads_*.json for details on failures"
                };
              }
            } catch (error) {
              logger.error(`Error downloading videos from extensive call data: ${error.message}`);
            }
          }
        } else {
          logger.warn('No extensive call data retrieved, falling back to standard method');
          
          // Fallback to old method if extensive calls don't work
          await downloadVideosUsingStandardMethod();
        }
      } catch (error) {
        logger.error(`Error exporting extensive call data: ${error.message}`);
        logger.info('Falling back to standard video download method');
        
        // Fallback to old method if extensive calls don't work
        await downloadVideosUsingStandardMethod();
      }
      
      // Fallback method using the old approach for downloading videos
      async function downloadVideosUsingStandardMethod() {
        if (enableVideoDownloads && exportedData.calls && exportedData.calls.calls && Array.isArray(exportedData.calls.calls)) {
          logger.info(`Found ${exportedData.calls.calls.length} calls, attempting to download videos using signed URLs (fallback method)`);
          
          // Initialize video downloader with custom storage path if configured
          // Pass a refresh URL callback to handle expired URLs
          const videoDownloader = new VideoDownloader(
            config.gong.accessKey,
            config.gong.basicToken,
            config.storage.videoPath,
            async (callId) => {
              try {
                // Try to get a fresh URL for this call ID
                const refreshedUrl = await gongExport.getSignedMediaUrl(callId);
                if (refreshedUrl) {
                  logger.info(`Successfully refreshed URL for call ${callId} (fallback method)`);
                  return refreshedUrl;
                }
              } catch (error) {
                logger.warn(`Failed to refresh URL for call ${callId} (fallback method): ${error.message}`);
              }
              return null;
            }
          );
          
          // Download videos with signed URLs
          try {
            // Pass the gongExport instance to allow the downloader to get signed URLs
            const downloadedVideos = await videoDownloader.downloadVideosForCalls(exportedData.calls.calls, gongExport);
            exportedData.videoDownloads = downloadedVideos;
            
            if (downloadedVideos.length > 0) {
              logger.info(`Downloaded ${downloadedVideos.length} videos from call recordings using signed URLs (fallback method)`);
              saveToFile(downloadedVideos, `video_downloads_${new Date().toISOString().replace(/:/g, '-')}.json`);
              
              // Add note to the combined export about video downloads
              exportedData.videoDownloadSummary = {
                totalCalls: exportedData.calls.calls.length,
                successfulDownloads: downloadedVideos.length,
                videoDirectory: config.storage.videoPath || path.join(__dirname, '../exports/videos'),
                method: "standard_fallback"
              };
            } else {
              logger.info('No videos were successfully downloaded using fallback method');
              
              // Add note to the combined export about video downloads
              exportedData.videoDownloadSummary = {
                totalCalls: exportedData.calls.calls.length,
                successfulDownloads: 0,
                method: "standard_fallback",
                note: "Check failed_video_downloads_*.json for details on failures"
              };
            }
          } catch (error) {
            logger.error(`Error downloading videos using fallback method: ${error.message}`);
          }
        }
      }
      
      // If video downloads are disabled, log a message
      if (!enableVideoDownloads) {
        logger.info('Video downloads are disabled. Set enableVideoDownloads to true in src/export.js to enable.');
        exportedData.videoDownloadSummary = {
          enabled: false,
          note: "Video downloads are disabled. Edit src/export.js to enable this feature."
        };
      }
    } catch (error) {
      logger.error('Error exporting call data, continuing with other exports');
    }

    try {
      // Export and save user data
      exportedData.users = await gongExport.exportUserData();
      saveToFile(exportedData.users, `users_${new Date().toISOString().replace(/:/g, '-')}.json`);
      logger.info('Successfully exported user data');
    } catch (error) {
      logger.error('Error exporting user data, continuing with other exports');
    }

    try {
      // Export and save CRM data
      exportedData.crm = await gongExport.exportCrmData();
      saveToFile(exportedData.crm, `crm_${new Date().toISOString().replace(/:/g, '-')}.json`);
      logger.info('Successfully exported CRM data');
    } catch (error) {
      logger.error('Error exporting CRM data, continuing with other exports');
    }

    try {
      // Export and save analytics data
      exportedData.analytics = await gongExport.exportAnalyticsData();
      saveToFile(exportedData.analytics, `analytics_${new Date().toISOString().replace(/:/g, '-')}.json`);
      logger.info('Successfully exported analytics data');
    } catch (error) {
      logger.error('Error exporting analytics data, continuing with other exports');
    }

    // Save all exported data to a combined file
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const combinedFilePath = saveToFile(exportedData, `gong_export_${timestamp}.json`);
    
    logger.info('Data export completed successfully');
    logger.info(`All data saved to ${combinedFilePath}`);
    
    return {
      exportedData,
      savedFiles: {
        combined: combinedFilePath
      }
    };
  } catch (error) {
    logger.error('Fatal error during export process', { error: error.message });
    throw error;
  }
}

// Execute the export function if this module is run directly
if (require.main === module) {
  exportGongData()
    .then(data => {
      logger.info('Export complete');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Export failed', { error: error.message });
      process.exit(1);
    });
}

module.exports = exportGongData;
