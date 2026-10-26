// Runs before each test file. Points the app at the isolated test database.
process.env.APP_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://mission:mission_dev_pw@localhost:5432/mission_test";
process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APP_URL = "http://localhost:3000";
process.env.EMAIL_TRANSPORT = "log";
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_tests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
process.env.STORAGE_DIR = "./storage/test-uploads";
