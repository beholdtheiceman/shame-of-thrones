"use client";

import { signIn } from "next-auth/react";

/** Shown when authStatus === "anonymous" and the user tries to act. */
export function SignInGate() {
  return (
    <div className="sign-in-gate">
      <p>Only sworn subjects may act in the Realm.</p>
      <button type="button" onClick={() => signIn("google")}>
        Pledge your oath — Sign in with Google
      </button>
    </div>
  );
}
