const { defineConfig } = require('cypress')
const fs = require('fs')
const path = require('path')

module.exports = defineConfig({
  reporter: 'cypress-mochawesome-reporter',
  reporterOptions: {
    reportDir: 'cypress/results',
    charts: true,
    reportPageTitle: 'Cypress Test Results',
    embeddedScreenshots: true,
    inlineAssets: true,
    overwrite: false,
    html: false,
    json: true,
  },
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}',
    supportFile: 'cypress/support/e2e.js',
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 60000,
    video: false,
    screenshotOnRunFailure: true,
    setupNodeEvents(on, config) {
      require('cypress-mochawesome-reporter/plugin')(on)

      let usersBackup = null
      const usersFilePath = path.join(process.cwd(), 'data', 'users.json')

      // Save a merged JSON after every run so the AI agent can read it locally
      on('after:run', (results) => {
        const resultsDir = path.join(process.cwd(), 'cypress', 'results')
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true })
        fs.writeFileSync(
          path.join(resultsDir, 'merged.json'),
          JSON.stringify(results, null, 2),
        )
      })

      on('task', {
        backupUsers() {
          usersBackup = fs.readFileSync(usersFilePath, 'utf-8')
          return null
        },
        restoreUsers() {
          if (usersBackup !== null) {
            fs.writeFileSync(usersFilePath, usersBackup)
            usersBackup = null
          }
          return null
        },
        resetUsers() {
          fs.writeFileSync(usersFilePath, '[]')
          return null
        },
      })
    },
  },
})
