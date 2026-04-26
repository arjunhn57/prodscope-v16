import { useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { AuthBackdrop } from "./components/AuthBackdrop";
import { BrandLockup } from "./components/BrandLockup";
import { AuthCard } from "./components/AuthCard";
import { AuthTrustStrip } from "./components/AuthTrustStrip";
import { useGoogleAuth } from "./googleAuth";
import { EDITORIAL_EASE } from "../report/tokens";

// Temporary guest mode (paired with backend GUEST_MODE_ENABLED). When on,
// the LoginPage skips the Google sign-in form entirely and redirects to
// the upload page. Marketing-CTA "Login" / "Get Started" clicks land
// directly in the app.
const GUEST_MODE = import.meta.env.VITE_GUEST_MODE === "true";

interface LocationState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  const redirectTo = locationState?.from?.pathname ?? "/upload";

  if (GUEST_MODE) {
    return <Navigate to={redirectTo} replace />;
  }

  const googleAuth = useGoogleAuth();
  const [googleErr, setGoogleErr] = useState<string | null>(null);

  const handleGoogleSuccess = (response: CredentialResponse) => {
    const credential = response.credential;
    if (!credential) {
      setGoogleErr("Google did not return a credential. Try again.");
      return;
    }
    setGoogleErr(null);
    googleAuth.mutate(credential, {
      onSuccess: () => navigate(redirectTo, { replace: true }),
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Sign-in failed. Please try again.";
        setGoogleErr(message);
      },
    });
  };

  const handleGoogleError = () => {
    setGoogleErr("Google sign-in was cancelled or failed. Please try again.");
  };

  const submitting = googleAuth.isPending;

  return (
    <div className="min-h-dvh w-full relative flex flex-col items-center justify-center px-6 py-16 md:py-20 overflow-hidden bg-bg-primary">
      <AuthBackdrop />

      <div className="relative z-10 w-full flex flex-col items-center gap-8">
        <BrandLockup />

        <AuthCard>
          <div className="text-center mb-6">
            <motion.h2
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
              className="text-[26px] md:text-[28px] font-bold text-text-primary leading-[1.15]"
              style={{
                fontFamily: "var(--font-heading)",
                letterSpacing: "-0.02em",
              }}
            >
              Sign in to ProdScope
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05, ease: EDITORIAL_EASE }}
              className="mt-2 text-[14.5px] text-text-secondary"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              ProdScope is in private beta. Sign in with Google to continue.
            </motion.p>
          </div>

          <div className="flex justify-center" aria-busy={submitting}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              theme="outline"
              size="large"
              text="continue_with"
              shape="rectangular"
              width="320"
              useOneTap={false}
            />
          </div>

          {googleErr && (
            <p
              role="alert"
              className="mt-4 text-xs text-danger text-center"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {googleErr}
            </p>
          )}

          <p
            className="mt-6 text-[11.5px] text-text-muted text-center leading-relaxed"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            By continuing, you agree to our{" "}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="underline hover:text-text-secondary"
            >
              Terms
            </a>{" "}
            and{" "}
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="underline hover:text-text-secondary"
            >
              Privacy Policy
            </a>
            .
          </p>
        </AuthCard>

        <AuthTrustStrip />
      </div>
    </div>
  );
}
