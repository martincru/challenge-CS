import RegisterPage from '../pages/RegisterPage'

describe('Register', () => {
  before(() => {
    cy.task('backupUsers')
  })

  after(() => {
    cy.task('restoreUsers')
  })

  beforeEach(() => {
    cy.task('resetUsers')
    cy.clearCookies()
  })

  context('Page structure', () => {
    it('renders all form fields and navigation links', () => {
      RegisterPage.visit()
      RegisterPage.nameInput.should('be.visible')
      RegisterPage.emailInput.should('be.visible')
      RegisterPage.passwordInput.should('be.visible')
      RegisterPage.submitButton.should('be.visible').and('contain', 'Create Account')
      RegisterPage.loginLink.should('be.visible')
    })
  })

  context('Happy path', () => {
    it('registers a new user and redirects to /dashboard', () => {
      cy.fixture('users').then(({ newUser }) => {
        RegisterPage.visit()
        RegisterPage.registerAs(newUser)
        cy.url().should('include', '/dashboard')
      })
    })
  })

  context('Negative cases', () => {
    it('shows error when registering with an already registered email', () => {
      cy.fixture('users').then(({ duplicate }) => {
        cy.registerUser(duplicate)
        cy.clearCookies()
        RegisterPage.visit()
        RegisterPage.registerAs(duplicate)
        RegisterPage.errorMessage
          .should('be.visible')
          .and('contain', 'Email already registered')
      })
    })

    it('shows error when submitting an empty form', () => {
      RegisterPage.visit()
      RegisterPage.submit()
      RegisterPage.errorMessage
        .should('be.visible')
        .and('contain', 'required')
    })
  })

  context('API failure handling', () => {
    it('shows an error message when the server returns 500', () => {
      cy.intercept('POST', '/api/auth/register', {
        statusCode: 500,
        body: { error: 'Internal server error' },
      }).as('registerRequest')

      cy.fixture('users').then(({ newUser }) => {
        RegisterPage.visit()
        RegisterPage.registerAs(newUser)
      })

      cy.wait('@registerRequest')
      RegisterPage.errorMessage.should('be.visible')
    })
  })

  context('Navigation', () => {
    it('navigates to the login page via the sign in link', () => {
      RegisterPage.visit()
      RegisterPage.loginLink.click()
      cy.url().should('include', '/login')
    })
  })
})
