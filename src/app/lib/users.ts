import fs from 'fs'
import path from 'path'

const USERS_FILE = path.join(process.cwd(), 'data', 'users.json')

export interface User {
  id: string
  name: string
  email: string
  passwordHash: string
  createdAt: string
}

export function getUsers(): User[] {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf-8')
    return JSON.parse(data) as User[]
  } catch {
    return []
  }
}

export function findUserByEmail(email: string): User | undefined {
  const users = getUsers()
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase())
}

export function createUser(user: User): void {
  const users = getUsers()
  users.push(user)
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}
