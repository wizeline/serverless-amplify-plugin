module.exports = {
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    [
      "@semantic-release/github",
      {
        "assets": [
          {
            "path": "index.js"
          },
          {
            "path": "CHANGELOG.md"
          },
          {
            "path": "package.json"
          },
          {
            "path": "package-lock.json"
          }
        ]
      }
    ],
    "@semantic-release/git"
  ],
  "preset": "angular",
  "npmPublish": false
}