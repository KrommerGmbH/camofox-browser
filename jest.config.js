module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000, // 60 seconds per test
  
  // Run tests sequentially to avoid resource conflicts
  maxWorkers: 1,
  
  // Test file patterns
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/'
  ],

  // Generated release artifacts contain a second package.json and must not be
  // indexed as source modules after local portable-package builds.
  modulePathIgnorePatterns: [
    '<rootDir>/build/'
  ],
  
  // Setup and teardown
  globalSetup: '<rootDir>/tests/helpers/global-test-state-setup.js',
  globalTeardown: '<rootDir>/tests/helpers/global-test-state-teardown.js',
  
  // Verbose output
  verbose: true,
  
  // Always run the complete suite so CI produces full cross-platform evidence
  // instead of hiding later failures behind the first red suite.
  bail: 0,
  
  // Coverage settings (optional)
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ],
  
  // Reporter settings
  reporters: [
    'default',
    ...(process.env.CI ? [['jest-junit', { outputDirectory: 'test-results' }]] : [])
  ]
};
