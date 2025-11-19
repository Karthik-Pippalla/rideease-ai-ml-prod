const http = require('http');

const port = process.env.PORT || 8080;

const req = http.get({ hostname: '127.0.0.1', port, path: '/healthz', timeout: 2000 }, (res) => {
  if (res.statusCode >= 200 && res.statusCode < 300) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
