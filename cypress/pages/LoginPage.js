class LoginPage {
  // Locators 
  get emailInput()    { return cy.get('[data-testid="email-input"]') }
  get passwordInput() { return cy.get('[data-testid="password-input"]') }
  get submitButton()  { return cy.get('[data-testid="submit-button"]') }
  get errorMessage()  { return cy.get('[data-testid="error-messagee"]') }
  get registerLink()  { return cy.get('[data-testid="register-link"]') }

  // Actions 
  visit() {
    cy.visit('/login')
  }

  fillForm(email, password) {
    this.emailInput.clear().type(email)
    this.passwordInput.clear().type(password)
  }

  submit() {
    this.submitButton.click()
  }

  /** Fill and submit the login form in one call */
  loginAs(email, password) {
    this.fillForm(email, password)
    this.submit()
  }
}

export default new LoginPage()
