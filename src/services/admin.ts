import { getSupabaseClient } from './supabaseClient'
import { isRecord } from '../domain/guards'

export type CoachRight = 'finalise_review' | 'manage_coaches'
export type AdminCoach = { userId: string; email: string; rights: CoachRight[] }
export type AdminTeam = { id: string; name: string; coaches: AdminCoach[] }

const coachRights: readonly CoachRight[] = ['finalise_review', 'manage_coaches']

// Admin calls need a signed-in coach account. Anonymous sessions never create one here.
async function accountRpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured.')
  const { data: sessionData } = await client.auth.getSession()
  if (!sessionData.session || sessionData.session.user.is_anonymous) throw new Error('Sign in with your coach account first.')
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

function parseRights(value: unknown): CoachRight[] {
  if (!Array.isArray(value)) throw new Error('Invalid coach rights.')
  return value.filter((right): right is CoachRight => coachRights.includes(right as CoachRight))
}

export async function isPlatformAdmin(): Promise<boolean> {
  const client = getSupabaseClient()
  if (!client) return false
  const { data: sessionData } = await client.auth.getSession()
  if (!sessionData.session || sessionData.session.user.is_anonymous) return false
  return (await accountRpc('is_platform_admin')) === true
}

export async function loadAdminDashboard(): Promise<AdminTeam[]> {
  const value = await accountRpc('admin_dashboard')
  if (!Array.isArray(value)) throw new Error('Invalid admin dashboard response.')
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.coaches)) {
      throw new Error('Invalid admin team.')
    }
    return {
      id: item.id,
      name: item.name,
      coaches: item.coaches.map((coach) => {
        if (!isRecord(coach) || typeof coach.userId !== 'string' || typeof coach.email !== 'string') {
          throw new Error('Invalid admin coach.')
        }
        return { userId: coach.userId, email: coach.email, rights: parseRights(coach.rights) }
      }),
    }
  })
}

export async function setTeamCoach(teamId: string, email: string, rights: CoachRight[]) {
  await accountRpc('set_team_coach', { p_team_id: teamId, p_email: email.trim(), p_rights: rights })
}

export async function removeTeamCoach(teamId: string, userId: string) {
  await accountRpc('remove_team_coach', { p_team_id: teamId, p_user_id: userId })
}
