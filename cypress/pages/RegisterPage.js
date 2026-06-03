class RegisterPage {
  // Locators 
  get nameInput()     { return cy.get('[data-testid="name-input"]') }
  get emailInput()    { return cy.get('[data-testid="email-input"]') }
  get passwordInput() { return cy.get('[data-testid="password-input"]') }
  get submitButton()  { return cy.get('[data-testid="submit-button"]') }
  get errorMessage()  { return cy.get('[data-testid="error-message"]') }
  get loginLink()     { return cy.get('[data-testid="login-link"]') }

  // Actions
  visit() {
    cy.visit('/register')
  }

  /** Fills only the fields provided — allows partial form submissions for negative tests */
  fillForm({ name, email, password } = {}) {
    if (name)     this.nameInput.clear().type(name)
    if (email)    this.emailInput.clear().type(email)
    if (password) this.passwordInput.clear().type(password)
  }

  submit() {
    this.submitButton.click()
  }

  /** Fill and submit the registration form in one call */
  registerAs(user) {
    this.fillForm(user)
    this.submit()
  }
}

export default new RegisterPage()
