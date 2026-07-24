module.exports = {
  ci: {
    collect: {
      url: [
        "http://127.0.0.1:2370/",
        "http://127.0.0.1:2370/p/designing-yohaku/",
        "http://127.0.0.1:2370/latex/"
      ],
      numberOfRuns: 1,
      settings: {
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage",
        preset: "desktop"
      }
    },
    assert: {
      assertions: {
        "categories:performance": ["error", {minScore: 0.8}],
        "categories:accessibility": ["error", {minScore: 0.9}],
        "categories:best-practices": ["error", {minScore: 0.9}],
        "categories:seo": ["error", {minScore: 0.9}],
        "largest-contentful-paint": ["warn", {maxNumericValue: 3000}],
        "total-byte-weight": ["error", {maxNumericValue: 1500000}]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: "output/lighthouse"
    }
  }
};
