import { getSession } from '@/app/lib/session'
import { redirect } from 'next/navigation'
import LogoutButton from './LogoutButton'

export default async function DashboardPage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <span className="text-lg font-semibold text-gray-900">Challenge App</span>
          <LogoutButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h1
            data-testid="welcome-message"
            className="text-3xl font-bold text-gray-900 mb-2"
          >
            Welcome, {session.name}!
          </h1>
          <p
            data-testid="user-email"
            className="text-gray-500 text-sm"
          >
            Signed in as <span className="font-medium text-gray-700">{session.email}</span>
          </p>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-xl p-5">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Account</p>
              <p className="text-2xl font-bold text-blue-900 mt-1">Active</p>
            </div>
            <div className="bg-green-50 rounded-xl p-5">
              <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">Sessions</p>
              <p className="text-2xl font-bold text-green-900 mt-1">1</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-5">
              <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Role</p>
              <p className="text-2xl font-bold text-purple-900 mt-1">User</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
