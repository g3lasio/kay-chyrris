import { trpc } from "@/lib/trpc";
import { useCallback } from "react";

/** Session state for the partner portal (partnerAuth.me / logout). */
export function usePartnerAuth() {
  const utils = trpc.useUtils();
  const meQuery = trpc.partnerAuth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.partnerAuth.logout.useMutation();

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      utils.partnerAuth.me.setData(undefined, null);
      await utils.invalidate();
      window.location.href = "/login";
    }
  }, [logoutMutation, utils]);

  return {
    partner: meQuery.data ?? null,
    loading: meQuery.isLoading,
    isAuthenticated: Boolean(meQuery.data),
    refresh: () => meQuery.refetch(),
    logout,
  };
}
