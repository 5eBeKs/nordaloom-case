import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { forgetPersonal } from "@/lib/offline"
import { forgetCustomerOnDevice } from "@/lib/checkout"

export type Profile = {
  id: string
  full_name: string | null
  role: "customer" | "owner"
}

type AuthState = {
  user: User | null
  profile: Profile | null
  /** True until the initial session has been restored. */
  loading: boolean
  isOwner: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

/** Their orders, addresses, bag and the way back into their orders don't stay on the device. */
function forgetCustomer(queryClient: QueryClient) {
  forgetCustomerOnDevice()
  forgetPersonal(queryClient)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Signed out here, in another tab, or because the sign-in ran out: their orders,
      // addresses, bag and the way back into their orders don't stay on the device.
      if (event === "SIGNED_OUT") forgetCustomer(queryClient)
      setSession(next)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const user = session?.user ?? null

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("id", user!.id)
        .maybeSingle()
      if (error) throw error
      return data as Profile | null
    },
  })

  const signOut = async () => {
    await supabase.auth.signOut()
    forgetCustomer(queryClient)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user ? profile ?? null : null,
        loading,
        isOwner: profile?.role === "owner",
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
