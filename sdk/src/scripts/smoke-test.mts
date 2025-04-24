import { $ } from "../lib/$.mjs";
import puppeteer from "puppeteer-core";
import { setTimeout } from "node:timers/promises";
import { resolve } from "path";
import { fileURLToPath } from "url";
import * as process from "process";
import {
  install,
  computeExecutablePath,
  detectBrowserPlatform,
} from "@puppeteer/browsers";

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "localhost";
const URL = `http://${HOST}:${PORT}`;
const TIMEOUT = 30000; // 30 seconds timeout
const RETRIES = 3;

interface HealthCheckResult {
  status: string;
  verificationPassed: boolean;
  timestamp?: number;
  rawResult?: unknown;
  error?: string;
}

// Define the expected health check response type
interface HealthCheckResponse {
  status: string;
  timestamp?: number;
  [key: string]: unknown;
}

async function runSmokeTest() {
  console.log(`🧪 Running smoke tests against ${URL}`);

  // First check if server is up
  let isServerUp = false;
  for (let i = 0; i < RETRIES; i++) {
    try {
      console.log(`Checking if server is up (attempt ${i + 1}/${RETRIES})...`);
      await $`curl -s -o /dev/null -w "%{http_code}" ${URL}`;
      isServerUp = true;
      break;
    } catch (error) {
      console.log(`Server not up yet, retrying in 2 seconds...`);
      await setTimeout(2000);
    }
  }

  if (!isServerUp) {
    console.error(`❌ Failed to connect to server at ${URL}`);
    process.exit(1);
  }

  // Get browser path - use the puppeteer browsers API
  let browserPath: string;
  try {
    console.log("Finding Chrome executable...");
    // First try using environment variable if set
    if (process.env.CHROME_PATH) {
      browserPath = process.env.CHROME_PATH;
      console.log(`Using Chrome from environment variable: ${browserPath}`);
    } else {
      // Use puppeteer's programmatic API
      console.log("Using @puppeteer/browsers API to find or install Chrome...");

      // Detect platform
      const platform = detectBrowserPlatform();
      if (!platform) {
        throw new Error("Failed to detect browser platform");
      }

      try {
        // Try to compute the path first (this will check if it's installed)
        browserPath = computeExecutablePath({
          browser: "chrome",
          channel: "stable",
          platform,
        });
        console.log(`Found existing Chrome at: ${browserPath}`);
      } catch (error) {
        // If path computation fails, install Chrome
        console.log("No Chrome installation found. Installing Chrome...");
        await install({
          browser: "chrome",
          channel: "stable",
          platform,
        });

        // Now compute the path for the installed browser
        browserPath = computeExecutablePath({
          browser: "chrome",
          channel: "stable",
          platform,
        });
        console.log(`Installed and using Chrome at: ${browserPath}`);
      }
    }
  } catch (error) {
    console.error("❌ Failed to find Chrome executable:", error);
    process.exit(1);
  }

  console.log(`🚀 Launching browser from ${browserPath}`);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Set a timeout for the navigation
    page.setDefaultNavigationTimeout(TIMEOUT);

    // Test server-side health check
    console.log(`🔍 Testing server-side health check: ${URL}/?__health`);
    await page.goto(`${URL}/?__health`, { waitUntil: "networkidle0" });

    // Validate server-side health check
    const serverHealthResult = await page.evaluate(async () => {
      try {
        // Look for health status indicator in the page
        const healthElement = document.querySelector(
          '[data-testid="health-status"]'
        );
        if (!healthElement) {
          return {
            status: "error",
            verificationPassed: false,
            error: "Health status element not found in the page",
          };
        }

        const status = healthElement.getAttribute("data-status");
        const timestamp = parseInt(
          healthElement.getAttribute("data-timestamp") || "0",
          10
        );
        const serverTimestamp = parseInt(
          healthElement.getAttribute("data-server-timestamp") || "0",
          10
        );

        // Verify timestamps are reasonable (within 60 seconds of now)
        const now = Date.now();
        const isTimestampRecent = Math.abs(now - timestamp) < 60000;
        const isServerTimestampRecent = Math.abs(now - serverTimestamp) < 60000;

        return {
          status: status || "error",
          verificationPassed:
            status === "ok" && isTimestampRecent && isServerTimestampRecent,
          timestamp,
          serverTimestamp,
          error:
            status !== "ok"
              ? "Health check did not return ok status"
              : undefined,
        };
      } catch (error) {
        return {
          status: "error",
          verificationPassed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    if (serverHealthResult.verificationPassed) {
      console.log("✅ Server-side health check passed!");
      console.log(`✅ Server timestamp: ${serverHealthResult.serverTimestamp}`);
    } else {
      console.error(
        `❌ Server-side health check failed. Status: ${serverHealthResult.status}`
      );
      if (serverHealthResult.error) {
        console.error(`❌ Error: ${serverHealthResult.error}`);
      }
      process.exit(1);
    }

    // Test client-side health check (typically involves a button click)
    console.log("🔍 Testing client-side health check");

    // Click the refresh button to trigger client-side health check
    const refreshButtonExists = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="refresh-health"]');
      return !!button;
    });

    if (refreshButtonExists) {
      await page.click('[data-testid="refresh-health"]');
      // Wait for client-side update to complete
      await page.waitForFunction(
        () => {
          const indicator = document.querySelector(
            '[data-testid="health-status"]'
          );
          return (
            indicator &&
            indicator.getAttribute("data-client-timestamp") !== null
          );
        },
        { timeout: 5000 }
      );

      // Validate client-side health check
      const clientHealthResult = await page.evaluate(async () => {
        try {
          const healthElement = document.querySelector(
            '[data-testid="health-status"]'
          );
          if (!healthElement) {
            return {
              status: "error",
              verificationPassed: false,
              error: "Health status element not found in the page",
            };
          }

          const status = healthElement.getAttribute("data-status");
          const clientTimestamp = parseInt(
            healthElement.getAttribute("data-client-timestamp") || "0",
            10
          );

          // Verify timestamp is reasonable (within 60 seconds of now)
          const now = Date.now();
          const isClientTimestampRecent =
            Math.abs(now - clientTimestamp) < 60000;

          return {
            status: status || "error",
            verificationPassed: status === "ok" && isClientTimestampRecent,
            clientTimestamp,
            error:
              status !== "ok"
                ? "Client health check did not return ok status"
                : undefined,
          };
        } catch (error) {
          return {
            status: "error",
            verificationPassed: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });

      if (clientHealthResult.verificationPassed) {
        console.log("✅ Client-side health check passed!");
        console.log(
          `✅ Client timestamp: ${clientHealthResult.clientTimestamp}`
        );
      } else {
        console.error(
          `❌ Client-side health check failed. Status: ${clientHealthResult.status}`
        );
        if (clientHealthResult.error) {
          console.error(`❌ Error: ${clientHealthResult.error}`);
        }
        process.exit(1);
      }
    } else {
      console.log(
        "⚠️ No client-side refresh button found, skipping client-side health check"
      );
    }

    // Take a screenshot for CI artifacts if needed
    await page.screenshot({ path: "smoke-test-result.png" });
  } catch (error) {
    console.error("❌ Smoke test failed:", error);
    process.exit(1);
  } finally {
    await browser.close();
  }

  console.log("✨ All smoke tests completed successfully!");
}

// Run the smoke test if this file is executed directly
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runSmokeTest().catch((error) => {
    console.error("❌ Unhandled error in smoke test:", error);
    process.exit(1);
  });
}

export { runSmokeTest };
