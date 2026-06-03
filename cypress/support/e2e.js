import './commands'

// Take a screenshot after every test (pass or fail)
afterEach(function () {
  const safeName = this.currentTest.fullTitle().replace(/[^a-z0-9]/gi, '_').toLowerCase()
  cy.screenshot(safeName)
})
