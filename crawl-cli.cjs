const path = require('path');
const fs = require('fs');
const { runCrawl } = require('./crawler/run.js');

// Default config
const MAX_STEPS = 20;

async function testCrawl() {
  const packageName = process.argv[2];
  
  if (!packageName) {
    console.error('Usage: node test-cli.js <package.name>');
    console.error('Example: node test-cli.js com.instagram.android');
    process.exit(1);
  }

  const screenshotDir = path.join(__dirname, 'test-artifacts', packageName);
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  console.log(`Starting crawl test for package: ${packageName}`);
  console.log(`Artifacts will be saved to: ${screenshotDir}\n`);

  try {
    const result = await runCrawl({
      screenshotDir,
      packageName,
      maxSteps: MAX_STEPS,
      appProfile: { packageName, activities: [], permissions: [], appName: packageName },
      // Optional defaults
      credentials: {},
      goldenPath: '',
      goals: '',
      painPoints: '',
      onProgress: (status) => {
        if (status.message) console.log(`[Stream] ${status.message}`);
      }
    });

    console.log('\n--- CRAWL COMPLETE ---');
    console.log(`Unique States Found: ${result.stats.uniqueStates}`);
    console.log(`Total Steps Taken: ${result.stats.totalSteps}`);
    console.log(`Stop Reason: ${result.stopReason}`);
    console.log(`Outputs in: ${screenshotDir}`);
  } catch (error) {
    console.error('\nCrawl failed with error:', error);
  }
}

testCrawl();
