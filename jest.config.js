module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/functions'],
  collectCoverageFrom: [
    'functions/utils/**/*.js',
    '!functions/utils/openai.js'
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      statements: 70,
      branches: 50,
      functions: 60
    }
  }
};
