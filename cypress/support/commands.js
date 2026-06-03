/**
 * Custom Cypress Commands
 */

/** Log in programmatically via API — skips the UI for tests that just need a session */
Cypress.Commands.add('login', (email, password) => {
  cy.request({
    method: 'POST',
    url: '/api/auth/login',
    body: { email, password },
    failOnStatusCode: true,
  })
})

/** Register a user via API — uses failOnStatusCode: false to tolerate duplicates */
Cypress.Commands.add('registerUser', (user) => {
  cy.request({
    method: 'POST',
    url: '/api/auth/register',
    body: user,
    failOnStatusCode: false,
  })
})

/** Register a user and immediately log in — useful for tests that need an active session */
Cypress.Commands.add('registerAndLogin', (user) => {
  cy.request('POST', '/api/auth/register', user)
  cy.request('POST', '/api/auth/login', { email: user.email, password: user.password })
})

