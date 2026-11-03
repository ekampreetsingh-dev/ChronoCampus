import { Navigate, useNavigate } from 'react-router-dom'
import { ShieldX, UserRoundSearch } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, Card, Spinner } from './ui/primitives'
import Brand from './Brand'

const HOME = { admin: '/admin', teacher: '/teacher', student: '/student' }

function Screen({ icon: Icon, tone, title, body, action }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen grid place-items-center px-5 py-8">
      <div className="w-full max-w-[460px]">
        <div className="mb-6">
          <Brand />
        </div>
        <Card data-tone={tone} className="px-6 py-8 text-center">
          <span className="avatar avatar-lg mx-auto mb-4" data-tone={tone} aria-hidden>
            <Icon size={22} />
          </span>
          <h1 className="display text-lg font-bold">{title}</h1>
          {body ? <p className="lede mt-2 mx-auto">{body}</p> : null}
          <div className="flex items-center justify-center gap-2 mt-6 flex-wrap">
            {action}
            <Button variant="ghost" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/**
 * Route guard. The role is read from the resolved profile, never from the URL or
 * from anything the client asserts, so a stale link cannot open another portal.
 */
export default function ProtectedRoute({ role, children }) {
  const { booting, user, profile, access, denial, signOut } = useApp()

  if (booting) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Brand showWord={false} />
          <Spinner label="Checking your authorization…" size={18} />
        </div>
      </div>
    )
  }

  if (!user && !profile) return <Navigate to="/login" replace />

  if (access === 'denied' || access === 'conflict') {
    return (
      <Screen
        icon={access === 'conflict' ? UserRoundSearch : ShieldX}
        tone="danger"
        title={access === 'conflict' ? 'Two school records share this email' : 'Access not granted'}
        body={denial?.message}
        action={
          <Button variant="primary" onClick={signOut}>
            Sign out
          </Button>
        }
      />
    )
  }

  const actual = profile?.role

  if (!actual) {
    return (
      <Screen
        icon={ShieldX}
        tone="danger"
        title="No role could be resolved"
        body="Your account signed in, but the school directory did not return a role for it. Please contact the administration."
      />
    )
  }

  if (actual !== role) {
    return (
      <Screen
        icon={ShieldX}
        tone="warning"
        title={`The ${role} area is not for your role`}
        body={`The school directory assigned you the ${actual} role. You cannot open the ${role} portal with it.`}
        action={
          <Button variant="primary" onClick={() => navigate(HOME[actual])}>
            Go to my {actual} portal
          </Button>
        }
      />
    )
  }

  return children
}
