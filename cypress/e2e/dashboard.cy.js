import DashboardPage from '../pages/DashboardPage'

describe('Dashboard', () => {
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

  context('Unauthenticated access', () => {
    beforeEach(() => {
      cy.clearCookies()
    })

    it('redirects to /login when visiting /dashboard without a session', () => {
      DashboardPage.visit()
      cy.url().should('include', '/login')
    })
  })

  context('Authenticated access', () => {
    beforeEach(() => {
      cy.fixture('users').then(({ valid }) => {
        cy.login(valid.email, valid.password)
      })
      DashboardPage.visit()
    })

    it('displays the welcome message with the user name', () => {
      cy.fixture('users').then(({ valid }) => {
        DashboardPage.welcomeMessage.should('contain', valid.name)
      })
    })

    it('displays the signed-in user email and name', () => {
      cy.fixture('users').then(({ valid }) => {
        DashboardPage.assertUserInfo(valid.name, valid.email)
      })
    })

    it('shows the logout button', () => {
      DashboardPage.logoutButton
        .should('be.visible')
        .and('contain', 'Sign Out')
    })

    it('logs out and redirects to /login', () => {
      DashboardPage.logout()
      cy.url().should('include', '/login')
    })

    it('cannot access /dashboard after logging out', () => {
      DashboardPage.logout()
      cy.url().should('include', '/login')
      DashboardPage.visit()
      cy.url().should('include', '/login')
    })
  })
})
