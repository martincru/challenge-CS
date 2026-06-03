import LoginPage from '../pages/LoginPage'

describe('Login', () => {
  before(() => {
    cy.task('backupUsers')
    cy.task('resetUsers')
    cy.fixture('users').then(({ valid }) => {
      cy.registerUser(valid)
    })
  })

  after(() => {
    cy.task('restoreUsers')
  })

  beforeEach(() => {
    cy.clearCookies()
    LoginPage.visit()
  })

  context('Page structure', () => {
    it('renders all form fields and navigation links', () => {
      LoginPage.emailInput.should('be.visible')
      LoginPage.passwordInput.should('be.visible')
      LoginPage.submitButton.should('be.visible').and('contain', 'Sign In')
      LoginPage.registerLink.should('be.visible')
    })
  })

  context('Happy path', () => {
    it('logs in with valid credentials and redirects to /dashboard', () => {
      cy.fixture('users').then(({ valid }) => {
        LoginPage.loginAs(valid.email, valid.password)
        cy.url().should('include', '/dashboard')
      })
    })
  })

  context('Negative cases', () => {
    it('shows error message with incorrect password', () => {
      cy.fixture('users').then(({ valid, wrongPassword }) => {
        LoginPage.loginAs(valid.email, wrongPassword.password)
        LoginPage.errorMessage
          .should('be.visible')
          .and('contain', 'Invalid credentials')
      })
    })

    it('shows error message for unregistered email', () => {
      cy.fixture('users').then(({ unknown }) => {
        LoginPage.loginAs(unknown.email, unknown.password)
        LoginPage.errorMessage
          .should('be.visible')
          .and('contain', 'Invalid credentials')
      })
    })
  })

  context('API failure handling', () => {
    it('shows an error message when the server returns 500', () => {
      cy.intercept('POST', '/api/auth/login', {
        statusCode: 500,
        body: { error: 'Internal server error' },
      }).as('loginRequest')

      cy.fixture('users').then(({ valid }) => {
        LoginPage.loginAs(valid.email, valid.password)
      })

      cy.wait('@loginRequest')
      LoginPage.errorMessage
        .should('be.visible')
        .and('contain', 'Internal server error')
    })
  })

  context('Navigation', () => {
    it('navigates to the register page via the sign up link', () => {
      LoginPage.registerLink.click()
      cy.url().should('include', '/register')
    })
  })
})
