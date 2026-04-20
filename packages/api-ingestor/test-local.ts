import { handler } from './index';
import 'dotenv/config'; // So it reads your ALPHA_VANTAGE_KEY

// Mock the Lambda 'event' and 'context'
const run = async () => {
  console.log("🚀 Starting local test...");
  const result = await handler({ test: true }); 
  console.log("✅ Result:", result);
};

run();