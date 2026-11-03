import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useApp } from './context/AppContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import { Toaster } from './components/ui/primitives'
import {
  AdminCodes,
  AdminLayout,
  AdminOverview,
  AdminSections,
  AdminSessions,
  AdminSettings,
  AdminStaffDirectory,
  AdminStudents,
  AdminSubstitutes,
  AdminTeachers,
  AdminTimetable,
  AdminBellSchedules,
  AdminWorkload,
  AdminReports,
} from './pages/Admin/AdminSection'
import { SubjectsPage } from './pages/Admin/SubjectsPage'
import { ActivityLogsPage } from './pages/Admin/ActivityLogsPage'
import { CalendarPage } from './pages/Admin/CalendarPage'
import AdminGroupsPage from './pages/Admin/GroupsPage'
import MyGroups from './pages/Groups/MyGroups'
import GroupPage from './pages/Groups/GroupPage'
import { TeacherHomework, TeacherLayout, TeacherOverview, TeacherProfile, TeacherSubstitutions, TeacherTimetable } from './pages/TeacherPortal'
import {
  StudentAcademic,
  StudentHomework,
  StudentLayout,
  StudentOverview,
  StudentProfile,
  StudentTimetable,
} from './pages/StudentPortal'

function Index() {
  const { booting, profile, access } = useApp()
  const navigate = useNavigate()
  useEffect(() => {
    if (!booting && access !== 'granted') navigate('/login', { replace: true })
  }, [booting, access, navigate])
  if (!booting && access === 'granted' && profile?.role) return <Navigate to={`/${profile.role}`} replace />
  return <Login />
}

/** Supabase redirects here after Google OAuth; the session is already in the URL. */
function AuthCallback() {
  const { refreshSession } = useApp()
  const navigate = useNavigate()
  useEffect(() => {
    let alive = true
    refreshSession?.().then((s) => {
      if (alive) navigate(s?.access === 'granted' ? `/${s.profile.role}` : '/login', { replace: true })
    })
    return () => {
      alive = false
    }
  }, [navigate, refreshSession])
  return <Login />
}

export default function App() {
  const { toasts, dismissToast } = useApp()
  return (
    <>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="timetable" element={<AdminTimetable />} />
          <Route path="substitutes" element={<AdminSubstitutes />} />
          <Route path="workload" element={<AdminWorkload />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="staff" element={<AdminStaffDirectory />} />
          <Route path="teachers" element={<AdminTeachers />} />
          <Route path="students" element={<AdminStudents />} />
          <Route path="sections" element={<AdminSections />} />
          <Route path="subjects" element={<SubjectsPage />} />
          <Route path="groups" element={<AdminGroupsPage />} />
          <Route path="groups/:groupId" element={<GroupPage base="/admin" />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="activity" element={<ActivityLogsPage />} />
          <Route path="sessions" element={<AdminSessions />} />
          <Route path="codes" element={<AdminCodes />} />
          <Route path="schedules" element={<AdminBellSchedules />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>

        <Route
          path="/teacher"
          element={
            <ProtectedRoute role="teacher">
              <TeacherLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<TeacherOverview />} />
          <Route path="timetable" element={<TeacherTimetable />} />
          <Route path="homework" element={<TeacherHomework />} />
          <Route path="substitutions" element={<TeacherSubstitutions />} />
          <Route path="groups" element={<MyGroups />} />
          <Route path="groups/:groupId" element={<GroupPage base="/teacher" />} />
          <Route path="profile" element={<TeacherProfile />} />
        </Route>

        <Route
          path="/student"
          element={
            <ProtectedRoute role="student">
              <StudentLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<StudentOverview />} />
          <Route path="timetable" element={<StudentTimetable />} />
          <Route path="homework" element={<StudentHomework />} />
          <Route path="academic" element={<StudentAcademic />} />
          <Route path="groups" element={<MyGroups />} />
          <Route path="groups/:groupId" element={<GroupPage base="/student" />} />
          <Route path="profile" element={<StudentProfile />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
