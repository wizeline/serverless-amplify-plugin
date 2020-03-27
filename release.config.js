module.exports = {
  "plugins": [
    [
      "@semantic-release/commit-analyzer",
      {
        "preset": "angular"
      }
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        "preset": "angular"
      }
    ],
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        "npmPublish": false
      }
    ],
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
  ]
}