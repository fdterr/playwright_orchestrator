import dotenv from "dotenv";
import express, { Request, Response, NextFunction } from 'express';
import playwright from 'playwright'; 

// --- Type Definitions ---
interface ExecuteScriptBody { // For the POST request body
  script?: string;
}

interface SuccessResponse {
  result: any; // Can be any type returned by the script
}

interface ErrorResponse {
  error: string;
}

// --- Constants ---
const PORT = process.env.PORT || 8080;
const CDP_ENDPOINT_URL_DEFAULT = 'http://localhost:9222';

// --- Express App Initialization ---
const app = express();
app.use(express.json()); // Enable JSON request body parsing

app.post('/execute-script', async (req: Request<{}, any, ExecuteScriptBody, any>, res: Response<SuccessResponse | ErrorResponse>) => {
  const { script: userScriptString } = req.body; 
  let browser: playwright.Browser | null = null; 

  console.log("userScriptString", userScriptString);

  if (!userScriptString || typeof userScriptString !== 'string' || userScriptString.trim() === '') {
    return res.status(400).json({ error: 'Script parameter is missing or empty in request body' });
  }

  try {
    const useLocalPlaywright = process.env.USE_LOCAL_PLAYWRIGHT === 'true';

    if (useLocalPlaywright) {
      console.log('Attempting to launch local Playwright Chromium instance (USE_LOCAL_PLAYWRIGHT=true)...');
      try {
        browser = await playwright.chromium.launch(); // Add launch options here if ever needed
        console.log('Successfully launched local Playwright Chromium instance.');
      } catch (launchError: any) {
        console.error('Failed to launch local Playwright Chromium:', launchError.message);
        // console.error(launchError); // Log the full error for more details
        return res.status(503).json({ error: `Failed to launch local Playwright Chromium: ${launchError.message}` });
      }
    } else {
      const cdpUrl = process.env.CDP_ENDPOINT_URL || CDP_ENDPOINT_URL_DEFAULT;
      console.log(`Attempting to connect to CDP endpoint: ${cdpUrl} (USE_LOCAL_PLAYWRIGHT is false or not set)...`);
      try {
        browser = await playwright.chromium.connectOverCDP(cdpUrl);
        console.log('Successfully connected to remote Chrome instance via CDP.');
      } catch (connectionError: any) {
        console.error('Failed to connect to remote Chrome via CDP:', connectionError.message);
        // console.error(connectionError); // Log the full error for more details
        return res.status(503).json({ error: `Failed to connect to remote Chrome via CDP: ${connectionError.message}` });
      }
    }

    // 4. Dynamically execute the script
    // The 'chromium' object (playwright.chromium) and the 'browser' object will be in scope for the user script.
    // The script is wrapped in an async IIFE to allow top-level await and capture its return value.
    console.log('Executing user script...');
    const scriptFunction = new Function('browser', 'chromium', 'require', `return (async () => { ${userScriptString} })();`);
    
    let scriptResult: any;
    try {
      // Pass the connected browser instance, the chromium namespace, and the require function
      scriptResult = await scriptFunction(browser, playwright.chromium, require);
      console.log('User script executed successfully.');
    } catch (scriptError: any) {
      console.error('Script execution failed:', scriptError.message);
      // console.error(scriptError);
      return res.status(500).json({ error: `Script execution failed: ${scriptError.message}` });
    }

    // 5. Send success response
    // If scriptResult is undefined, return null as per requirements.
    const responsePayload: SuccessResponse = { result: scriptResult === undefined ? null : scriptResult };
    res.status(200).json(responsePayload);

  } catch (error: any) { // Catch any unexpected errors not caught by specific try-catch blocks
    console.error('Unexpected server error:', error.message);
    // console.error(error);
    // Ensure a generic error is sent if it's not one of the anticipated ones.
    if (!res.headersSent) {
      res.status(500).json({ error: `Internal server error: ${error.message}` });
    }
  } finally {
    // 6. Ensure browser is closed if it was successfully connected
    if (browser) {
      console.log('Closing browser connection...');
      try {
        await browser.close();
        console.log('Browser connection closed successfully.');
      } catch (closeError: any) {
        console.error('Error closing browser:', closeError.message);
        // This error typically won't be sent to the client if a response has already been sent.
        // It's important for server-side logging.
      }
    }
  }
});

// --- Server Start ---
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Awaiting POST requests to /execute-script with a JSON body containing a 'script' field.`);
  console.log(`Playwright mode: ${process.env.USE_LOCAL_PLAYWRIGHT === 'true' ? 'Local Launch' : 'CDP Connection'}`);
  if (process.env.USE_LOCAL_PLAYWRIGHT !== 'true') {
    console.log(`  CDP_ENDPOINT_URL for connection: ${process.env.CDP_ENDPOINT_URL || CDP_ENDPOINT_URL_DEFAULT}`);
  } else {
    console.log(`  Launching local Playwright-managed Chromium.`);
  }
});