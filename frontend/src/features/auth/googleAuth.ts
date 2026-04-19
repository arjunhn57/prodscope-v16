import { useMutation } from "@tanstack/react-query";
import { api, type ApiResponse } from "../../api/client";
import { useAuthStore, type AuthUser } from "../../stores/auth";

interface GoogleAuthResponse {
  token: string;
  expiresIn: string;
  user: AuthUser;
}

export function useGoogleAuth() {
  const login = useAuthStore((s) => s.login);

  return useMutation({
    mutationFn: async (credential: string) => {
      const res = await api.post<ApiResponse<GoogleAuthResponse>>(
        "auth/google",
        { credential }
      );
      return res.data;
    },
    onSuccess: (data) => {
      login(data.token, data.user);
    },
  });
}
