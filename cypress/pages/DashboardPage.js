class DashboardPage {
  // Locators 
  get welcomeMessage() { return cy.get('[data-testid="welcome-message"]') }
  get userEmail()      { return cy.get('[data-testid="user-email"]') }
  get logoutButton()   { return cy.get('[data-testid="logout-button"]') }

  // Actions 
  visit() {
    cy.visit('/dashboard', { failOnStatusCode: false })
  }

  logout() {
    this.logoutButton.click()
  }

  // Assertions 
  assertUserInfo(name, email) {
    this.welcomeMessage.should('contain', name)
    this.userEmail.should('contain', email)
  }
}

export default new DashboardPage()
